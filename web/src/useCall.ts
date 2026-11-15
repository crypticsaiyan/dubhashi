import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { SUMMARY_TURN_ID } from "../../shared/protocol";
import type { ClientMessage, Profile, ServerMessage } from "../../shared/protocol";
import { Mic, PcmPlayer } from "./audio";
import { initialState, reduce } from "./state";
import type { Entry } from "./state";
import { VideoLink } from "./video";
import type { VideoState } from "./video";

/** Lets the worklet post its last block before the turn closes. */
const RELEASE_FLUSH_MS = 60;

/** What a reloaded page needs to step back into its call. */
export interface SavedCall {
  code: string;
  token: string;
  polite: boolean;
  profile: Profile;
  entries: Entry[];
}

const STORAGE_KEY = "dubhashi:call";

/**
 * Phones often reload a tab after the person switches apps, for example to
 * share the call code. Session storage lets them rejoin instead of losing the
 * call. It is per tab and cleared when the tab closes.
 */
export function loadSavedCall(): SavedCall | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as SavedCall | null;
    return saved?.code && saved.token && saved.profile ? saved : null;
  } catch {
    return null;
  }
}

function profileOf(message: ClientMessage): Profile | null {
  if (message.type !== "create" && message.type !== "join") return null;
  const { name, language, gender, voiceId } = message;
  return { name, language, gender, voiceId };
}

function socketUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws`;
}

function framesUrl(code: string, token: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const query = new URLSearchParams({ code, token });
  return `${scheme}://${location.host}/frames?${query}`;
}

export function useCall() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const socket = useRef<WebSocket | null>(null);
  const session = useRef<{ code: string; token: string } | null>(null);
  const closing = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mic = useMemo(() => new Mic(), []);
  const player = useMemo(() => new PcmPlayer(), []);
  /** Audio of each heard turn, kept so it can be replayed. */
  const clips = useRef(new Map<number, ArrayBuffer[]>());
  const receiving = useRef<number | null>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The joiner yields on colliding video offers. Kept across reconnects. */
  const polite = useRef(false);
  const profile = useRef<Profile | null>(null);
  const entries = useRef<Entry[]>([]);
  /** Set when this page reloaded into a call, so the peer resets its video link. */
  const reloaded = useRef(false);
  const [video, setVideo] = useState<VideoState>({ local: null, remote: null, frame: null });

  /** Clears the playing marker once queued audio has actually played. */
  const finishAfterPlayback = useCallback(
    (turnId: number, then?: () => void) => {
      if (finishTimer.current) clearTimeout(finishTimer.current);
      finishTimer.current = setTimeout(() => {
        finishTimer.current = null;
        then?.();
        dispatch({ type: "playback_finished", turnId });
      }, player.remainingMs());
    },
    [player],
  );

  const persist = useCallback(() => {
    if (!session.current || !profile.current) return;
    const saved: SavedCall = {
      ...session.current,
      polite: polite.current,
      profile: profile.current,
      entries: entries.current,
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Private mode or full storage: rejoining after a reload just won't work.
    }
  }, []);

  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  }, []);

  const link = useMemo(() => new VideoLink((signal) => send({ type: "signal", signal }), setVideo), [send]);

  const open = useCallback(
    (first: ClientMessage) => {
      const ws = new WebSocket(socketUrl());
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify(first));
      ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data !== "string") {
          player.push(event.data);
          if (receiving.current !== null) clips.current.get(receiving.current)?.push(event.data);
          return;
        }
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "joined") {
          session.current = { code: message.code, token: message.token };
          link.configure(message.iceServers, polite.current, framesUrl(message.code, message.token));
          persist();
          if (reloaded.current) {
            reloaded.current = false;
            ws.send(JSON.stringify({ type: "signal", signal: { kind: "hello" } } satisfies ClientMessage));
          }
        }
        if (message.type === "signal") return void link.handle(message.signal);
        if (message.type === "audio_start") {
          receiving.current = message.turnId;
          if (message.turnId !== SUMMARY_TURN_ID) clips.current.set(message.turnId, []);
        }
        if (message.type === "audio_end") {
          const { turnId } = message;
          receiving.current = null;
          finishAfterPlayback(turnId, () => {
            if (turnId !== SUMMARY_TURN_ID) send({ type: "playback_done", turnId });
          });
        }
        dispatch(message);
      };
      ws.onclose = () => {
        if (closing.current || !session.current) return;
        const { code, token } = session.current;
        retry.current = setTimeout(() => open({ type: "resume", code, token }), 1500);
      };
    },
    [finishAfterPlayback, link, persist, player, send],
  );

  const start = useCallback(
    async (first: ClientMessage) => {
      player.unlock();
      polite.current = first.type === "join";
      profile.current = profileOf(first);
      try {
        await mic.start();
      } catch {
        dispatch({
          type: "local_error",
          message: "Microphone blocked. Allow microphone access and try again.",
        });
        return;
      }
      open(first);
    },
    [mic, open, player],
  );

  const resume = useCallback(
    async (saved: SavedCall) => {
      player.unlock();
      polite.current = saved.polite;
      profile.current = saved.profile;
      session.current = { code: saved.code, token: saved.token };
      entries.current = saved.entries;
      reloaded.current = true;
      dispatch({ type: "restore", entries: saved.entries });
      try {
        await mic.start();
      } catch {
        dispatch({
          type: "local_error",
          message: "Microphone blocked. Allow microphone access and try again.",
        });
        return;
      }
      open({ type: "resume", code: saved.code, token: saved.token });
    },
    [mic, open, player],
  );

  useEffect(() => {
    entries.current = state.entries;
    persist();
  }, [persist, state.entries]);

  const talkStart = useCallback(() => {
    send({ type: "talk_start" });
    mic.capture((block) => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(block);
    });
  }, [mic, send]);

  const talkEnd = useCallback(() => {
    setTimeout(() => {
      mic.release();
      send({ type: "talk_end" });
    }, RELEASE_FLUSH_MS);
  }, [mic, send]);

  const leave = useCallback(() => {
    closing.current = true;
    sessionStorage.removeItem(STORAGE_KEY);
    mic.stop();
    player.stop();
    link.close();
    socket.current?.close();
  }, [link, mic, player]);

  const replay = useCallback(
    (turnId: number) => {
      const clip = clips.current.get(turnId);
      // Never cut into live audio, or the server would miss playback_done.
      if (!clip?.length || receiving.current !== null || finishTimer.current) return;
      player.unlock();
      player.stop();
      clip.forEach((chunk) => player.push(chunk));
      dispatch({ type: "replay_start", turnId });
      finishAfterPlayback(turnId);
    },
    [finishAfterPlayback, player],
  );

  // The camera light must go out the moment the call ends.
  useEffect(() => {
    if (state.phase === "ended") link.close();
  }, [link, state.phase]);

  useEffect(
    () => () => {
      if (retry.current) clearTimeout(retry.current);
      if (finishTimer.current) clearTimeout(finishTimer.current);
      link.close();
    },
    [link],
  );

  return {
    state,
    mic,
    /** Call from a click. Mobile browsers mute audio not started by a gesture. */
    unlockAudio: () => player.unlock(),
    start,
    resume,
    sendText: (text: string) => send({ type: "text_turn", text }),
    talkStart,
    talkEnd,
    leave,
    replay,
    video,
    /** Rejects when the camera is blocked or missing. */
    toggleCamera: async () => (link.cameraOn ? link.stopCamera() : link.startCamera()),
    canReplay: (turnId: number) => Boolean(clips.current.get(turnId)?.length),
    confirm: (turnId: number, ok: boolean) => send({ type: "confirm", turnId, ok }),
    endCall: () => send({ type: "end_call" }),
    listenSummary: () => {
      player.unlock();
      send({ type: "summary_audio" });
    },
    clearNotice: () => dispatch({ type: "clear_notice" }),
  };
}
