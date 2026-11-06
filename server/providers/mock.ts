import { PLAYBACK_SAMPLE_RATE, languageName } from "../../shared/protocol";
import type { LanguageCode, Summary } from "../../shared/protocol";
import { extractNumbers } from "../text";
import type {
  HistoryTurn,
  SpeakerEmbedding,
  Speech,
  SttSession,
  SynthesisResult,
  Translation,
  TranslationRequest,
  Translator,
  VoiceChoice,
} from "./types";

/** Fake speech for tests and for running the UI without API keys. */
export class MockSpeech implements Speech {
  /** Transcript returned by the next session. Defaults to a canned line. */
  nextTranscript: string | null = null;
  failNextSynthesis = false;
  readonly synthesized: { text: string; language: LanguageCode; cloned: boolean }[] = [];

  openStt(): SttSession {
    let bytes = 0;
    return {
      write: (pcm) => {
        bytes += pcm.length;
      },
      finish: async () => {
        const scripted = this.nextTranscript;
        this.nextTranscript = null;
        if (scripted !== null) return scripted;
        return bytes > 0 ? "Mock speech, take 500 mg twice a day." : "";
      },
      abort: () => undefined,
    };
  }

  async synthesize(
    options: { text: string; language: LanguageCode; voice: VoiceChoice },
    onChunk: (pcm: Buffer) => void,
  ): Promise<SynthesisResult> {
    if (this.failNextSynthesis) {
      this.failNextSynthesis = false;
      throw new Error("Mock synthesis failure");
    }
    this.synthesized.push({
      text: options.text,
      language: options.language,
      cloned: Boolean(options.voice.embedding),
    });
    onChunk(tone(300));
    return { usedFallback: false };
  }

  async createVoice(): Promise<SpeakerEmbedding> {
    return { embedding: "mock", shape: [1, 768], dtype: "torch.bfloat16" };
  }
}

function tone(ms: number): Buffer {
  const samples = Math.floor((PLAYBACK_SAMPLE_RATE * ms) / 1000);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = Math.sin((2 * Math.PI * 330 * i) / PLAYBACK_SAMPLE_RATE) * 6000;
    pcm.writeInt16LE(Math.round(value), i * 2);
  }
  return pcm;
}

export class MockTranslator implements Translator {
  /** Replaces the next translation, for simulating a dropped number. */
  nextTranslation: string | null = null;
  readonly requests: TranslationRequest[] = [];

  async translate(request: TranslationRequest): Promise<Translation> {
    this.requests.push(request);
    const translation = this.nextTranslation ?? `[${languageName(request.to)}] ${request.text}`;
    this.nextTranslation = null;
    const facts = extractNumbers(translation).map((value) => `${value}?`);
    return { translation, spoken: translation, facts };
  }

  async backTranslate(text: string, _from: LanguageCode, to: LanguageCode): Promise<string> {
    return `[back to ${languageName(to)}] ${text}`;
  }

  async summarize(turns: HistoryTurn[], language: LanguageCode): Promise<Summary> {
    return {
      keyPoints: turns.map((turn) => `[${languageName(language)}] ${turn.text}`),
      nextSteps: [],
    };
  }
}
