import { randomBytes, randomUUID } from "node:crypto";
import { RELATIONSHIPS, SUMMARY_TURN_ID, PLAYBACK_SAMPLE_RATE } from "../shared/protocol";
import type {
  Gender,
  IceServer,
  LanguageCode,
  NoticeCode,
  Phase,
  Relationship,
  ServerMessage,
  Signal,
  Summary,
} from "../shared/protocol";
import type {
  HistoryTurn,
  SpeakerEmbedding,
  Speech,
  SttSession,
  Translation,
  Translator,
} from "./providers/types";
import { missingNumbers, splitForTts } from "./text";

export interface Connection {
  send(message: ServerMessage): void;
  sendAudio(pcm: Buffer): void;
}

export interface Member {
  id: string;
  token: string;
  name: string;
  language: LanguageCode;
  gender: Gender;
  embedding?: SpeakerEmbedding;
  isCaller: boolean;
  connection: Connection | null;
  summary?: Summary;
}

export interface RoomOptions {
  maxHoldMs: number;
  maxTurns: number;
  /** Added to audio length before giving up on a playback_done message. */
  playbackGraceMs: number;
  mock: boolean;
  /** Handed to browsers for the video link. */
  iceServers: IceServer[];
}

export const DEFAULT_ICE_SERVERS: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  maxHoldMs: 30_000,
  maxTurns: 200,
  playbackGraceMs: 5_000,
  mock: false,
  iceServers: DEFAULT_ICE_SERVERS,
};

const TOPICS: Record<Relationship, string> = {
  doctor: "A medical consultation",
  elder: "A family conversation",
  employer: "A conversation about work, wages or rent",
  friend: "A casual conversation",
};

interface ActiveTurn {
  id: number;
  speaker: Member;
  listener: Member;
  text: string;
  translation?: Translation;
  releasedAt: number;
  sttMs: number;
  llmMs: number;
  /** Time spent waiting for the speaker to confirm, excluded from latency. */
  confirmMs: number;
  abort: AbortController;
}

export class Room {
  readonly members: Member[] = [];
  phase: Phase = "waiting";
  /** Set whenever the room changes, for idle cleanup. */
  lastActivity = Date.now();

  private readonly history: HistoryTurn[] = [];
  private stt: SttSession | null = null;
  private speaking: Member | null = null;
  private turn: ActiveTurn | null = null;
  private turnSeq = 0;
  private holdTimer: NodeJS.Timeout | null = null;
  private playbackTimer: NodeJS.Timeout | null = null;
  private confirmStartedAt = 0;

  constructor(
    readonly code: string,
    readonly relationship: Relationship,
    private readonly speech: Speech,
    private readonly translator: Translator,
    private readonly options: RoomOptions = DEFAULT_ROOM_OPTIONS,
  ) {}

  addMember(
    profile: { name: string; language: LanguageCode; gender: Gender; embedding?: SpeakerEmbedding },
    connection: Connection,
  ): Member | null {
    if (this.members.length >= 2 || this.phase === "ended") return null;
    const member: Member = {
      ...profile,
      id: randomUUID(),
      token: randomBytes(24).toString("base64url"),
      isCaller: this.members.length === 0,
      connection,
    };
    this.members.push(member);
    this.welcome(member);
    if (this.members.length === 2) this.setPhase("idle");
    else this.broadcastState();
    return member;
  }

  resume(token: string, connection: Connection): Member | null {
    const member = this.members.find((m) => m.token === token);
    if (!member) return null;
    member.connection = connection;
    this.welcome(member);
    this.broadcastState();
    if (member.summary) connection.send({ type: "summary", summary: member.summary });
    return member;
  }

  disconnect(member: Member, connection: Connection): void {
    if (member.connection !== connection) return;
    member.connection = null;
    if (this.turn || this.speaking) this.cancelTurn();
    this.broadcastState();
  }

  /** Why this member may not start a turn now, if anything. */
  private blocked(member: Member): NoticeCode | null {
    if (!this.peerOf(member)?.connection) return "peer_offline";
    if (this.phase !== "idle") return "busy";
    if (this.turnSeq >= this.options.maxTurns) return "turn_limit";
    return null;
  }

  talkStart(member: Member): void {
    const blocked = this.blocked(member);
    if (blocked) return this.notify(member, blocked);

    this.speaking = member;
    this.stt = this.speech.openStt({
      language: member.language,
      topic: TOPICS[this.relationship],
      onError: (error) => {
        console.error("[stt]", error.message);
        if (this.speaking === member) this.failTurn(member);
      },
    });
    this.holdTimer = setTimeout(() => void this.talkEnd(member), this.options.maxHoldMs);
    this.setPhase("speaking");
  }

  audio(member: Member, pcm: Buffer): void {
    if (this.phase === "speaking" && this.speaking === member) this.stt?.write(pcm);
  }

  async talkEnd(member: Member): Promise<void> {
    if (this.phase !== "speaking" || this.speaking !== member || !this.stt) return;
    const peer = this.peerOf(member);
    if (!peer) return;
    this.clearHoldTimer();
    const stt = this.stt;
    const turn = this.beginTurn(member, peer);
    this.stt = null;
    this.speaking = null;
    this.setPhase("translating");

    try {
      turn.text = await stt.finish();
      turn.sttMs = Date.now() - turn.releasedAt;
    } catch (error) {
      console.error("[stt finish]", String(error));
      if (this.turn === turn) this.failTurn(member);
      return;
    }
    if (this.turn !== turn) return;
    await this.translateTurn(turn);
  }

  /** Same path as speech, minus recognition. */
  async textTurn(member: Member, text: string): Promise<void> {
    const blocked = this.blocked(member);
    if (blocked) return this.notify(member, blocked);
    const peer = this.peerOf(member);
    if (!peer) return;
    const turn = this.beginTurn(member, peer);
    turn.text = text;
    this.setPhase("translating");
    await this.translateTurn(turn);
  }

  private beginTurn(speaker: Member, listener: Member): ActiveTurn {
    const turn: ActiveTurn = {
      id: ++this.turnSeq,
      speaker,
      listener,
      text: "",
      releasedAt: Date.now(),
      sttMs: 0,
      llmMs: 0,
      confirmMs: 0,
      abort: new AbortController(),
    };
    this.turn = turn;
    return turn;
  }

  private async translateTurn(turn: ActiveTurn): Promise<void> {
    const { speaker: member, listener: peer, id } = turn;
    if (!turn.text.trim()) {
      this.notify(member, "not_heard");
      return this.finishTurn(turn);
    }
    member.connection?.send({ type: "my_turn", turnId: id, text: turn.text });

    try {
      const llmStart = Date.now();
      turn.translation = await this.translator.translate({
        text: turn.text,
        from: member.language,
        to: peer.language,
        relationship: this.relationship,
        speakerIsCaller: member.isCaller,
        history: this.history,
      });
      turn.llmMs = Date.now() - llmStart;
      if (this.turn !== turn) return;
    } catch (error) {
      console.error("[turn]", String(error));
      if (this.turn === turn) this.failTurn(member);
      return;
    }

    const mismatch = missingNumbers(turn.text, turn.translation.translation).length > 0;
    const strict = RELATIONSHIPS.find((r) => r.id === this.relationship)?.strictFacts;
    if (mismatch || (strict && turn.translation.facts.length > 0)) {
      this.confirmStartedAt = Date.now();
      this.setPhase("confirming");
      member.connection?.send({
        type: "confirm_needed",
        turnId: id,
        items: turn.translation.facts,
        mismatch,
      });
      return;
    }
    await this.deliver(turn);
  }

  async confirm(member: Member, turnId: number, ok: boolean): Promise<void> {
    const turn = this.turn;
    if (this.phase !== "confirming" || !turn || turn.id !== turnId || turn.speaker !== member) return;
    turn.confirmMs = Date.now() - this.confirmStartedAt;
    if (ok) return this.deliver(turn);
    member.connection?.send({ type: "turn_cancelled", turnId });
    this.finishTurn(turn);
  }

  playbackDone(member: Member, turnId: number): void {
    const turn = this.turn;
    if (this.phase === "playing" && turn?.id === turnId && turn.listener === member) {
      this.finishTurn(turn);
    }
  }

  async end(): Promise<void> {
    if (this.phase === "ended") return;
    this.cancelTurn();
    this.setPhase("ended");
    for (const member of this.members) member.connection?.send({ type: "summary_pending" });
    await Promise.all(
      this.members.map(async (member) => {
        try {
          member.summary = await this.translator.summarize(
            this.history,
            member.language,
            this.relationship,
          );
        } catch (error) {
          console.error("[summary]", String(error));
          member.summary = { keyPoints: [], nextSteps: [] };
        }
        member.connection?.send({ type: "summary", summary: member.summary });
      }),
    );
  }

  async speakSummary(member: Member): Promise<void> {
    const summary = member.summary;
    const connection = member.connection;
    if (!summary || !connection) return;
    const text = [...summary.keyPoints, ...summary.nextSteps].join(" ");
    if (!text) return;
    connection.send({ type: "audio_start", turnId: SUMMARY_TURN_ID });
    try {
      for (const part of splitForTts(text)) {
        await this.speech.synthesize(
          { text: part, language: member.language, voice: { gender: "female" } },
          (pcm) => connection.sendAudio(pcm),
        );
      }
    } catch (error) {
      console.error("[summary audio]", String(error));
      this.notify(member, "voice_failed");
    }
    connection.send({ type: "audio_end", turnId: SUMMARY_TURN_ID });
  }

  /** Passes video signalling to the other person. The server never touches media. */
  relaySignal(member: Member, signal: Signal): void {
    if (this.phase === "ended") return;
    this.peerOf(member)?.connection?.send({ type: "signal", signal });
  }

  /** Stops timers and upstream work. Called when the room is discarded. */
  dispose(): void {
    this.cancelTurn();
  }

  private async deliver(turn: ActiveTurn): Promise<void> {
    const { speaker, listener, id } = turn;
    const translation = turn.translation;
    if (!translation) return;
    this.setPhase("playing");
    listener.connection?.send({ type: "peer_turn", turnId: id, text: translation.translation });
    this.remember(turn, translation);

    // Runs beside TTS so the check adds no delay to the listener.
    void this.translator
      .backTranslate(translation.translation, listener.language, speaker.language)
      .then((text) => speaker.connection?.send({ type: "they_heard", turnId: id, text }))
      .catch((error) => console.error("[back-translate]", String(error)));

    const ttsStart = Date.now();
    let ttsMs = 0;
    let audioBytes = 0;
    listener.connection?.send({ type: "audio_start", turnId: id });
    try {
      for (const part of splitForTts(translation.spoken)) {
        const { usedFallback } = await this.speech.synthesize(
          {
            text: part,
            language: listener.language,
            voice: { gender: speaker.gender, embedding: speaker.embedding },
          },
          (pcm) => {
            if (this.turn !== turn) return;
            if (audioBytes === 0) {
              ttsMs = Date.now() - ttsStart;
              this.sendMetrics(turn, ttsMs);
            }
            audioBytes += pcm.length;
            listener.connection?.sendAudio(pcm);
          },
          turn.abort.signal,
        );
        if (usedFallback) this.notify(speaker, "voice_fallback");
      }
    } catch (error) {
      if (this.turn !== turn) return;
      console.error("[tts]", String(error));
      this.notify(speaker, "voice_failed");
      this.notify(listener, "voice_failed");
      listener.connection?.send({ type: "audio_end", turnId: id });
      return this.finishTurn(turn);
    }
    if (this.turn !== turn) return;
    listener.connection?.send({ type: "audio_end", turnId: id });

    const audioMs = (audioBytes / 2 / PLAYBACK_SAMPLE_RATE) * 1000;
    this.playbackTimer = setTimeout(
      () => this.finishTurn(turn),
      audioMs + this.options.playbackGraceMs,
    );
  }

  private remember(turn: ActiveTurn, translation: Translation): void {
    this.history.push({
      speaker: turn.speaker.name,
      text: `${turn.text} (translated: ${translation.translation})`,
      language: turn.speaker.language,
    });
  }

  private sendMetrics(turn: ActiveTurn, ttsMs: number): void {
    const totalMs = Date.now() - turn.releasedAt - turn.confirmMs;
    const metrics = { turnId: turn.id, sttMs: turn.sttMs, llmMs: turn.llmMs, ttsMs, totalMs };
    console.log(JSON.stringify({ event: "turn_metrics", room: this.code, ...metrics }));
    for (const member of this.members) member.connection?.send({ type: "metrics", metrics });
  }

  private finishTurn(turn: ActiveTurn): void {
    if (this.turn !== turn) return;
    this.clearPlaybackTimer();
    this.turn = null;
    this.setPhase("idle");
  }

  private failTurn(member: Member): void {
    this.notify(member, "turn_failed");
    this.cancelTurn();
  }

  /** Abandons any turn in progress and frees the talk button. */
  private cancelTurn(): void {
    this.clearHoldTimer();
    this.clearPlaybackTimer();
    this.stt?.abort();
    this.stt = null;
    this.speaking = null;
    this.turn?.abort.abort();
    this.turn = null;
    if (this.phase !== "ended" && this.phase !== "waiting") this.setPhase("idle");
  }

  private peerOf(member: Member): Member | undefined {
    return this.members.find((m) => m !== member);
  }

  private notify(member: Member, code: NoticeCode): void {
    member.connection?.send({ type: "notice", code });
  }

  private welcome(member: Member): void {
    member.connection?.send({
      type: "joined",
      code: this.code,
      token: member.token,
      memberId: member.id,
      relationship: this.relationship,
      mock: this.options.mock,
      iceServers: this.options.iceServers,
    });
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.broadcastState();
  }

  private broadcastState(): void {
    this.lastActivity = Date.now();
    const active = this.speaking ?? this.turn?.speaker ?? null;
    for (const member of this.members) {
      const peer = this.peerOf(member);
      member.connection?.send({
        type: "room",
        phase: this.phase,
        activeMemberId: active?.id ?? null,
        peer: peer
          ? { name: peer.name, language: peer.language, online: peer.connection !== null }
          : null,
      });
    }
  }

  private clearHoldTimer(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private clearPlaybackTimer(): void {
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
  }
}
