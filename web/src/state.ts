import type {
  NoticeCode,
  Phase,
  PeerInfo,
  Relationship,
  ServerMessage,
  Summary,
  TurnMetrics,
} from "../../shared/protocol";

export interface Entry {
  turnId: number;
  mine: boolean;
  text: string;
  theyHeard?: string;
}

export interface PendingConfirm {
  turnId: number;
  items: string[];
  mismatch: boolean;
}

export interface CallState {
  code: string | null;
  token: string | null;
  memberId: string | null;
  relationship: Relationship | null;
  mock: boolean;
  phase: Phase;
  activeMemberId: string | null;
  peer: PeerInfo | null;
  entries: Entry[];
  confirm: PendingConfirm | null;
  metrics: TurnMetrics | null;
  summary: Summary | null;
  summaryPending: boolean;
  notice: NoticeCode | null;
  error: string | null;
  /** Turn whose audio is coming out of the speaker now, live or replayed. */
  playingTurn: number | null;
}

export const initialState: CallState = {
  code: null,
  token: null,
  memberId: null,
  relationship: null,
  mock: false,
  phase: "waiting",
  activeMemberId: null,
  peer: null,
  entries: [],
  confirm: null,
  metrics: null,
  summary: null,
  summaryPending: false,
  notice: null,
  error: null,
  playingTurn: null,
};

export type CallAction =
  | ServerMessage
  | { type: "clear_notice" }
  | { type: "local_error"; message: string }
  | { type: "restore"; entries: Entry[] }
  | { type: "replay_start"; turnId: number }
  | { type: "playback_finished"; turnId: number };

export function reduce(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case "joined":
      return {
        ...state,
        code: action.code,
        token: action.token,
        memberId: action.memberId,
        relationship: action.relationship,
        mock: action.mock,
        error: null,
      };
    case "room":
      return {
        ...state,
        phase: action.phase,
        activeMemberId: action.activeMemberId,
        peer: action.peer,
        confirm: action.phase === "confirming" ? state.confirm : null,
      };
    case "my_turn":
      return {
        ...state,
        notice: null,
        entries: [...state.entries, { turnId: action.turnId, mine: true, text: action.text }],
      };
    case "peer_turn":
      return {
        ...state,
        notice: null,
        entries: [...state.entries, { turnId: action.turnId, mine: false, text: action.text }],
      };
    case "they_heard":
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.mine && entry.turnId === action.turnId ? { ...entry, theyHeard: action.text } : entry,
        ),
      };
    case "confirm_needed":
      return {
        ...state,
        confirm: { turnId: action.turnId, items: action.items, mismatch: action.mismatch },
      };
    case "turn_cancelled":
      return {
        ...state,
        confirm: null,
        entries: state.entries.filter((entry) => !(entry.mine && entry.turnId === action.turnId)),
      };
    case "audio_start":
    case "replay_start":
      return { ...state, playingTurn: action.turnId };
    case "playback_finished":
      return state.playingTurn === action.turnId ? { ...state, playingTurn: null } : state;
    case "metrics":
      return { ...state, metrics: action.metrics };
    case "summary_pending":
      return { ...state, summaryPending: true };
    case "summary":
      return { ...state, summary: action.summary, summaryPending: false };
    case "notice":
      return { ...state, notice: action.code };
    case "restore":
      return { ...state, entries: action.entries };
    case "clear_notice":
      return { ...state, notice: null };
    case "error":
    case "local_error":
      return { ...state, error: action.message };
    default:
      return state;
  }
}
