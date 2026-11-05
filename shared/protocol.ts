/** Wire protocol shared by the browser client and the Node server. */

export const LANGUAGES = [
  { code: "hi-IN", name: "Hindi", native: "हिन्दी" },
  { code: "bn-IN", name: "Bengali", native: "বাংলা" },
  { code: "ta-IN", name: "Tamil", native: "தமிழ்" },
  { code: "te-IN", name: "Telugu", native: "తెలుగు" },
  { code: "mr-IN", name: "Marathi", native: "मराठी" },
  { code: "kn-IN", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml-IN", name: "Malayalam", native: "മലയാളം" },
  { code: "gu-IN", name: "Gujarati", native: "ગુજરાતી" },
  { code: "pa-IN", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "en-IN", name: "English", native: "English" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export function isLanguage(value: unknown): value is LanguageCode {
  return LANGUAGES.some((l) => l.code === value);
}

export function languageName(code: LanguageCode): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/**
 * Who the person starting the call is talking to. This sets the register of
 * the translation and whether critical facts must be confirmed.
 */
export const RELATIONSHIPS = [
  { id: "doctor", label: "Doctor", strictFacts: true },
  { id: "elder", label: "Elder", strictFacts: false },
  { id: "employer", label: "Employer or landlord", strictFacts: true },
  { id: "friend", label: "Friend or family", strictFacts: false },
] as const;

export type Relationship = (typeof RELATIONSHIPS)[number]["id"];

export function isRelationship(value: unknown): value is Relationship {
  return RELATIONSHIPS.some((r) => r.id === value);
}

export type Gender = "female" | "male";

export type Phase =
  | "waiting" // only one person in the room
  | "idle" // either person may talk
  | "speaking" // someone is holding the talk button
  | "translating"
  | "confirming" // speaker must confirm a critical fact
  | "playing" // listener is hearing the translation
  | "ended";

export interface Profile {
  name: string;
  language: LanguageCode;
  gender: Gender;
  /** Id returned by POST /api/voice. Omit to use a stock voice. */
  voiceId?: string;
}

export type ClientMessage =
  | ({ type: "create"; relationship: Relationship } & Profile)
  | ({ type: "join"; code: string } & Profile)
  | { type: "resume"; code: string; token: string }
  | { type: "talk_start" }
  | { type: "talk_end" }
  /** A typed turn, for noisy places or when speech is not recognized. */
  | { type: "text_turn"; text: string }
  | { type: "confirm"; turnId: number; ok: boolean }
  | { type: "playback_done"; turnId: number }
  | { type: "end_call" }
  | { type: "summary_audio" }
  | { type: "signal"; signal: Signal };

/**
 * WebRTC signalling, relayed untouched to the other person. Calls carry video
 * only: voices always go through the interpreter, never straight across.
 */
export type Signal =
  | { kind: "description"; description: { type: "offer" | "answer"; sdp: string } }
  | {
      kind: "candidate";
      candidate: {
        candidate: string;
        sdpMid?: string | null;
        sdpMLineIndex?: number | null;
        usernameFragment?: string | null;
      };
    }
  | { kind: "camera"; on: boolean }
  /** Sent by a reloaded page: its old video link is gone, so drop yours. */
  | { kind: "hello" };

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface PeerInfo {
  name: string;
  language: LanguageCode;
  online: boolean;
}

export interface TurnMetrics {
  turnId: number;
  /** Button release to final transcript. */
  sttMs: number;
  /** Translation and fact extraction. */
  llmMs: number;
  /** TTS request to first audio byte. */
  ttsMs: number;
  /** Button release to first audio byte, excluding time spent confirming. */
  totalMs: number;
}

export interface Summary {
  keyPoints: string[];
  nextSteps: string[];
}

export type NoticeCode =
  | "not_heard"
  | "busy"
  | "peer_offline"
  | "turn_failed"
  | "voice_fallback"
  | "voice_failed"
  | "turn_limit";

export type ServerMessage =
  | {
      type: "joined";
      code: string;
      token: string;
      memberId: string;
      relationship: Relationship;
      mock: boolean;
      iceServers: IceServer[];
    }
  | { type: "room"; phase: Phase; activeMemberId: string | null; peer: PeerInfo | null }
  | { type: "my_turn"; turnId: number; text: string }
  | { type: "peer_turn"; turnId: number; text: string }
  | { type: "they_heard"; turnId: number; text: string }
  | { type: "confirm_needed"; turnId: number; items: string[]; mismatch: boolean }
  | { type: "turn_cancelled"; turnId: number }
  | { type: "audio_start"; turnId: number }
  | { type: "audio_end"; turnId: number }
  | { type: "metrics"; metrics: TurnMetrics }
  | { type: "summary_pending" }
  | { type: "summary"; summary: Summary }
  | { type: "notice"; code: NoticeCode }
  | { type: "signal"; signal: Signal }
  | { type: "error"; message: string };

/** Mic audio from the browser: 16 kHz mono signed 16-bit little-endian PCM. */
export const MIC_SAMPLE_RATE = 16000;

/** Audio to the browser: 24 kHz mono signed 16-bit little-endian PCM. */
export const PLAYBACK_SAMPLE_RATE = 24000;

/** Longest typed turn, in characters. */
export const MAX_TYPED_CHARS = 500;

/** Turn id used for spoken summaries, which are outside the turn sequence. */
export const SUMMARY_TURN_ID = 0;
