import type { Gender, LanguageCode, Relationship, Summary } from "../../shared/protocol";

export interface SpeakerEmbedding {
  embedding: string;
  shape: number[];
  dtype: string;
}

export interface VoiceChoice {
  gender: Gender;
  embedding?: SpeakerEmbedding;
}

export interface SttSession {
  /** Queue mic PCM. Safe to call before the upstream socket has opened. */
  write(pcm: Buffer): void;
  /** Flush audio, close the utterance, and resolve with the full transcript. */
  finish(): Promise<string>;
  abort(): void;
}

export interface SynthesisResult {
  /** True when a cloned voice failed and a stock voice was used instead. */
  usedFallback: boolean;
}

export interface Speech {
  openStt(options: {
    language: LanguageCode;
    topic?: string;
    onError: (error: Error) => void;
  }): SttSession;
  synthesize(
    options: { text: string; language: LanguageCode; voice: VoiceChoice },
    onChunk: (pcm: Buffer) => void,
    signal?: AbortSignal,
  ): Promise<SynthesisResult>;
  createVoice(wav: Buffer): Promise<SpeakerEmbedding>;
}

export interface HistoryTurn {
  speaker: string;
  text: string;
  language: LanguageCode;
}

export interface TranslationRequest {
  text: string;
  from: LanguageCode;
  to: LanguageCode;
  relationship: Relationship;
  /** True when the speaker is the person who started the call. */
  speakerIsCaller: boolean;
  history: HistoryTurn[];
}

export interface Translation {
  /** Text shown to the listener. */
  translation: string;
  /** TTS-ready text with numbers spelled out. */
  spoken: string;
  /** Questions in the speaker's language that read critical facts back. */
  facts: string[];
}

export interface Translator {
  translate(request: TranslationRequest): Promise<Translation>;
  /** Translates without seeing the original, so errors stay visible. */
  backTranslate(text: string, from: LanguageCode, to: LanguageCode): Promise<string>;
  summarize(
    turns: HistoryTurn[],
    language: LanguageCode,
    relationship: Relationship,
  ): Promise<Summary>;
}
