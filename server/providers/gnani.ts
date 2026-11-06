import WebSocket from "ws";
import { PLAYBACK_SAMPLE_RATE, MIC_SAMPLE_RATE } from "../../shared/protocol";
import type { Gender, LanguageCode } from "../../shared/protocol";
import { FrameBuffer, SampleAligner, SseParser } from "../audio";
import type { Config } from "../config";
import { RateLimitError, SerialQueue } from "../limiter";
import type { SpeakerEmbedding, Speech, SttSession, SynthesisResult, VoiceChoice } from "./types";

export class GnaniHttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`Gnani API ${status}: ${body.slice(0, 300)}`);
    this.name = "GnaniHttpError";
  }
}

export interface SttTiming {
  /** Frame send interval. 16 ms is twice real time, so a backlog drains. */
  frameIntervalMs: number;
  /** Wait after the last transcript for any trailing segment. */
  settleMs: number;
  /** Wait after commit when no speech was reported at all. */
  silenceMs: number;
  finishTimeoutMs: number;
}

const DEFAULT_TIMING: SttTiming = {
  frameIntervalMs: 16,
  settleMs: 150,
  silenceMs: 1200,
  finishTimeoutMs: 8000,
};

/**
 * One utterance on Prisma's realtime endpoint. A socket per press keeps the
 * app clear of the 15 minute session limit and the idle timeout, and the turn
 * lock means at most one session is open per room.
 */
export class GnaniSttSession implements SttSession {
  private readonly ws: WebSocket;
  private readonly framer = new FrameBuffer();
  private readonly frames: Buffer[] = [];
  private readonly segments: string[] = [];
  private readonly pump: NodeJS.Timeout;
  private segmentOpen = false;
  private pendingSegments = 0;
  private finishing = false;
  private committed = false;
  private settled = false;
  private settleTimer: NodeJS.Timeout | null = null;
  private deadline: NodeJS.Timeout | null = null;
  private resolveFinish: ((text: string) => void) | null = null;
  private rejectFinish: ((error: Error) => void) | null = null;

  constructor(
    url: string,
    headers: Record<string, string>,
    private readonly onError: (error: Error) => void,
    private readonly timing: SttTiming = DEFAULT_TIMING,
  ) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on("message", (data, isBinary) => {
      if (!isBinary) this.handleMessage(data.toString());
    });
    this.ws.on("unexpected-response", (_request, response) => {
      const status = response.statusCode ?? 0;
      this.fail(
        status === 429
          ? new RateLimitError("STT session rejected: rate limited")
          : new GnaniHttpError(status, "STT handshake refused"),
      );
    });
    this.ws.on("error", (error) => this.fail(error));
    this.ws.on("close", () => {
      if (this.finishing) this.resolve();
      else if (!this.settled) this.fail(new Error("STT socket closed early"));
    });
    this.pump = setInterval(() => this.drain(), timing.frameIntervalMs);
  }

  write(pcm: Buffer): void {
    if (this.finishing || this.settled) return;
    this.frames.push(...this.framer.push(pcm));
  }

  finish(): Promise<string> {
    if (this.settled) return Promise.resolve(this.transcript());
    this.finishing = true;
    const tail = this.framer.flush();
    if (tail) this.frames.push(tail);
    return new Promise((resolve, reject) => {
      this.resolveFinish = resolve;
      this.rejectFinish = reject;
      this.deadline = setTimeout(() => this.resolve(), this.timing.finishTimeoutMs);
      this.drain();
    });
  }

  abort(): void {
    this.settled = true;
    this.cleanup();
  }

  private drain(): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const frame = this.frames.shift();
    if (frame) {
      this.ws.send(frame);
    } else if (this.finishing && !this.committed) {
      this.committed = true;
      this.ws.send(JSON.stringify({ type: "commit" }));
      this.scheduleSettle();
    }
  }

  private handleMessage(raw: string): void {
    let message: { type?: string; text?: string; message?: string };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    switch (message.type) {
      case "speech_start":
        this.segmentOpen = true;
        break;
      case "processing":
        this.segmentOpen = false;
        this.pendingSegments += 1;
        break;
      case "transcript":
        this.segmentOpen = false;
        this.pendingSegments = Math.max(0, this.pendingSegments - 1);
        if (message.text?.trim()) this.segments.push(message.text.trim());
        break;
      case "error":
        this.fail(new Error(`STT error: ${message.message ?? "unknown"}`));
        return;
      default:
        return;
    }
    this.scheduleSettle();
  }

  private scheduleSettle(): void {
    if (!this.committed) return;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    if (this.segmentOpen || this.pendingSegments > 0) return;
    const wait = this.segments.length ? this.timing.settleMs : this.timing.silenceMs;
    this.settleTimer = setTimeout(() => this.resolve(), wait);
  }

  private transcript(): string {
    return this.segments.join(" ");
  }

  private resolve(): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    this.resolveFinish?.(this.transcript());
  }

  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    if (this.rejectFinish) this.rejectFinish(error);
    else this.onError(error);
  }

  private cleanup(): void {
    clearInterval(this.pump);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    if (this.deadline) clearTimeout(this.deadline);
    if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
    else this.ws.close();
  }
}

const V3_VOICES: Record<Gender, string> = { female: "Shivani", male: "Avinash" };

/**
 * Timbre v2.5 voices are tied to one language. The catalog gives no gender,
 * so this mapping is a best guess, used only if Timbre v3.0 is rejected.
 */
const V25_VOICES: Record<LanguageCode, Record<Gender, string>> = {
  "en-IN": { female: "Kaveri", male: "Pranav" },
  "hi-IN": { female: "Nalini", male: "Deepak" },
  "ta-IN": { female: "Asmita", male: "Asmita" },
  "te-IN": { female: "Suhana", male: "Suhana" },
  "kn-IN": { female: "Saanvi", male: "Kavin" },
  "ml-IN": { female: "Reshma", male: "Riyaan" },
  "mr-IN": { female: "Zahira", male: "Ishaan" },
  "bn-IN": { female: "Kirra", male: "Dhruva" },
  "gu-IN": { female: "Falak", male: "Veera" },
  "pa-IN": { female: "Mehuli", male: "Zayan" },
};

const AUDIO_CONFIG = {
  sample_rate: PLAYBACK_SAMPLE_RATE,
  num_channels: 1,
  sample_width: 2,
  encoding: "linear_pcm",
  container: "raw",
};

export class GnaniSpeech implements Speech {
  private stockModel: string;
  /** Free tier keys allow one active request, about one per second. */
  private readonly queue = new SerialQueue({ minGapMs: 1000, maxRetries: 4, retryBaseMs: 500 });

  constructor(private readonly config: Config) {
    this.stockModel = config.ttsModel;
  }

  openStt(options: {
    language: LanguageCode;
    topic?: string;
    onError: (error: Error) => void;
  }): SttSession {
    const headers: Record<string, string> = {
      "x-api-key-id": this.config.gnaniApiKey,
      language_code: options.language,
      model: "prisma-v3.0",
      format: "transcribe",
      "x-sample-rate": String(MIC_SAMPLE_RATE),
      "x-vad-threshold": "0.5",
      "x-min-silence-ms": "900",
    };
    if (options.topic) headers.topic = options.topic;
    return new GnaniSttSession(this.config.gnaniWsUrl, headers, options.onError);
  }

  async synthesize(
    options: { text: string; language: LanguageCode; voice: VoiceChoice },
    onChunk: (pcm: Buffer) => void,
    signal?: AbortSignal,
  ): Promise<SynthesisResult> {
    let emitted = false;
    const emit = (pcm: Buffer) => {
      emitted = true;
      onChunk(pcm);
    };

    if (options.voice.embedding) {
      const body = {
        text: options.text,
        model: "vachana-vc-v1",
        language: options.language,
        audio_config: AUDIO_CONFIG,
        speaker_embedding: options.voice.embedding,
      };
      try {
        await this.queue.run(() => this.stream(body, emit, signal));
        return { usedFallback: false };
      } catch (error) {
        if (emitted || signal?.aborted) throw error;
        console.warn("[tts] cloned voice failed, using stock voice:", String(error));
      }
    }

    try {
      await this.queue.run(() => this.stream(this.stockBody(options), emit, signal));
    } catch (error) {
      const rejected = error instanceof GnaniHttpError && [400, 403].includes(error.status);
      if (!rejected || emitted || this.stockModel === "timbre-v2.5") throw error;
      console.warn(`[tts] ${this.stockModel} rejected, switching to timbre-v2.5:`, String(error));
      this.stockModel = "timbre-v2.5";
      await this.queue.run(() => this.stream(this.stockBody(options), emit, signal));
    }
    return { usedFallback: Boolean(options.voice.embedding) };
  }

  async createVoice(wav: Buffer): Promise<SpeakerEmbedding> {
    return this.queue.run(async () => {
      const form = new FormData();
      form.append("audio_file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice.wav");
      const response = await fetch(`${this.config.gnaniBaseUrl}/api/v1/tts/voice-clone/embeddings`, {
        method: "POST",
        headers: { "X-API-Key-ID": this.config.gnaniApiKey },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 429) throw new RateLimitError();
      if (!response.ok) throw new GnaniHttpError(response.status, await response.text());
      const json = (await response.json()) as {
        data?: { voice_clone_embedding?: SpeakerEmbedding };
      };
      const embedding = json.data?.voice_clone_embedding;
      if (!embedding?.embedding) throw new Error("Embedding missing from Gnani response");
      return embedding;
    });
  }

  private stockBody(options: { text: string; language: LanguageCode; voice: VoiceChoice }) {
    const { text, language, voice } = options;
    const name =
      this.stockModel === "timbre-v2.5" ? V25_VOICES[language][voice.gender] : V3_VOICES[voice.gender];
    return { text, model: this.stockModel, voice: name, language, audio_config: AUDIO_CONFIG };
  }

  private async stream(
    body: unknown,
    onChunk: (pcm: Buffer) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const timeout = AbortSignal.timeout(30_000);
    const response = await fetch(`${this.config.gnaniBaseUrl}/api/v1/tts/sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-API-Key-ID": this.config.gnaniApiKey,
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (response.status === 429) throw new RateLimitError();
    if (!response.ok || !response.body) {
      throw new GnaniHttpError(response.status, await response.text());
    }

    const parser = new SseParser();
    const aligner = new SampleAligner();
    const decoder = new TextDecoder();
    for await (const bytes of response.body) {
      for (const event of parser.push(decoder.decode(bytes, { stream: true }))) {
        if (event.event === "error") throw new Error(`TTS error: ${event.data.slice(0, 300)}`);
        if (event.event !== "chunk") continue;
        const { audio } = JSON.parse(event.data) as { audio?: string };
        if (!audio) continue;
        const pcm = aligner.push(Buffer.from(audio, "base64"));
        if (pcm.length) onChunk(pcm);
      }
    }
  }
}
