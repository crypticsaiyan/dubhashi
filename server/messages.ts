import { MAX_TYPED_CHARS, isLanguage, isRelationship } from "../shared/protocol";
import type { ClientMessage, Gender, Profile, Signal } from "../shared/protocol";

/** Generous for one video track; real offers are 3 to 6 KB. */
const MAX_SDP = 16_000;
const MAX_CANDIDATE = 1_000;

const isGender = (value: unknown): value is Gender => value === "female" || value === "male";

function parseProfile(data: Record<string, unknown>): Profile | null {
  const { name, language, gender, voiceId } = data;
  if (typeof name !== "string" || !isLanguage(language) || !isGender(gender)) return null;
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return null;
  if (voiceId !== undefined && typeof voiceId !== "string") return null;
  return { name: trimmed, language, gender, voiceId };
}

const optional = (value: unknown, type: "string" | "number") =>
  value === undefined || value === null || typeof value === type;

function parseSignal(value: unknown): Signal | null {
  if (typeof value !== "object" || value === null) return null;
  const signal = value as Record<string, unknown>;
  if (signal.kind === "hello") return { kind: "hello" };
  if (signal.kind === "camera") {
    return typeof signal.on === "boolean" ? { kind: "camera", on: signal.on } : null;
  }
  if (signal.kind === "description") {
    const d = signal.description as Record<string, unknown> | null;
    if (typeof d !== "object" || d === null) return null;
    if ((d.type !== "offer" && d.type !== "answer") || typeof d.sdp !== "string") return null;
    if (d.sdp.length > MAX_SDP) return null;
    return { kind: "description", description: { type: d.type, sdp: d.sdp } };
  }
  if (signal.kind === "candidate") {
    const c = signal.candidate as Record<string, unknown> | null;
    if (typeof c !== "object" || c === null) return null;
    if (typeof c.candidate !== "string" || c.candidate.length > MAX_CANDIDATE) return null;
    if (!optional(c.sdpMid, "string") || !optional(c.sdpMLineIndex, "number")) return null;
    if (!optional(c.usernameFragment, "string")) return null;
    return {
      kind: "candidate",
      candidate: {
        candidate: c.candidate,
        sdpMid: c.sdpMid as string | null | undefined,
        sdpMLineIndex: c.sdpMLineIndex as number | null | undefined,
        usernameFragment: c.usernameFragment as string | null | undefined,
      },
    };
  }
  return null;
}

/** Validates untrusted JSON from a browser. Returns null when malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;

  switch (message.type) {
    case "create": {
      const profile = parseProfile(message);
      if (!profile || !isRelationship(message.relationship)) return null;
      return { type: "create", relationship: message.relationship, ...profile };
    }
    case "join": {
      const profile = parseProfile(message);
      if (!profile || typeof message.code !== "string") return null;
      return { type: "join", code: message.code.trim().toUpperCase(), ...profile };
    }
    case "resume":
      if (typeof message.code !== "string" || typeof message.token !== "string") return null;
      return { type: "resume", code: message.code, token: message.token };
    case "confirm":
      if (typeof message.turnId !== "number" || typeof message.ok !== "boolean") return null;
      return { type: "confirm", turnId: message.turnId, ok: message.ok };
    case "playback_done":
      if (typeof message.turnId !== "number") return null;
      return { type: "playback_done", turnId: message.turnId };
    case "text_turn": {
      if (typeof message.text !== "string") return null;
      const text = message.text.trim();
      if (!text || text.length > MAX_TYPED_CHARS) return null;
      return { type: "text_turn", text };
    }
    case "signal": {
      const signal = parseSignal(message.signal);
      return signal ? { type: "signal", signal } : null;
    }
    case "talk_start":
    case "talk_end":
    case "end_call":
    case "summary_audio":
      return { type: message.type };
    default:
      return null;
  }
}
