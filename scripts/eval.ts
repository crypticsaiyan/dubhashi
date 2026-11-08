/**
 * Runs 30 scripted turns through the real pipeline: Timbre speaks the line,
 * Prisma transcribes it, the LLM translates, Timbre speaks the translation.
 * Results go to eval/results.csv, with blank columns for native speakers to
 * rate naturalness and respect, since no script can judge those.
 *
 * Timbre audio is clean, so this measures latency and number handling, not
 * how well Prisma copes with real microphones.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { MIC_SAMPLE_RATE, PLAYBACK_SAMPLE_RATE } from "../shared/protocol";
import type { LanguageCode } from "../shared/protocol";
import { loadConfig } from "../server/config";
import { GnaniSpeech } from "../server/providers/gnani";
import { LlmTranslator } from "../server/providers/llm";
import { extractNumbers, missingNumbers } from "../server/text";

interface Line {
  language: LanguageCode;
  to: LanguageCode;
  text: string;
  numbers: string[];
}

const config = loadConfig();
const speech = new GnaniSpeech(config);
const llm = new LlmTranslator(config);
const lines = JSON.parse(readFileSync("eval/turns.json", "utf8")) as Line[];

const to16k = (pcm: Buffer) => {
  const ratio = PLAYBACK_SAMPLE_RATE / MIC_SAMPLE_RATE;
  const out = Buffer.alloc(Math.floor(pcm.length / 2 / ratio) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    out.writeInt16LE(pcm.readInt16LE(Math.floor(i * ratio) * 2), i * 2);
  }
  return out;
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
};

const csv = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
const rows = [
  [
    "from", "to", "source", "heard", "translation", "stt_ms", "llm_ms", "tts_first_byte_ms", "total_ms",
    "numbers_heard", "numbers_translated", "flagged_by_guard", "native_naturalness_1_5", "native_respect_1_5",
  ].join(","),
];
const totals: number[] = [];
let withNumbers = 0;
let heardOk = 0;
let translatedOk = 0;
let failures = 0;

for (const [index, line] of lines.entries()) {
  try {
    const source: Buffer[] = [];
    await speech.synthesize({ text: line.text, language: line.language, voice: { gender: "female" } }, (pcm) =>
      source.push(pcm),
    );
    const session = speech.openStt({ language: line.language, onError: (e) => console.error(e.message) });
    const audio = to16k(Buffer.concat(source));
    for (let offset = 0; offset < audio.length; offset += 1024) {
      session.write(audio.subarray(offset, offset + 1024));
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const released = Date.now();
    const heard = await session.finish();
    const sttMs = Date.now() - released;

    const llmStart = Date.now();
    const result = await llm.translate({
      text: heard,
      from: line.language,
      to: line.to,
      relationship: "doctor",
      // The Malayalam lines are the doctor, who received the call.
      speakerIsCaller: line.language !== "ml-IN",
      history: [],
    });
    const llmMs = Date.now() - llmStart;

    const ttsStart = Date.now();
    let ttsMs = 0;
    await speech.synthesize({ text: result.spoken, language: line.to, voice: { gender: "male" } }, () => {
      ttsMs ||= Date.now() - ttsStart;
    });
    const totalMs = sttMs + llmMs + ttsMs;
    totals.push(totalMs);

    const has = (text: string) => line.numbers.every((n) => extractNumbers(text).includes(n));
    const numbersHeard = has(heard);
    const numbersTranslated = has(result.translation);
    const flagged = missingNumbers(heard, result.translation).length > 0;
    if (line.numbers.length) {
      withNumbers += 1;
      if (numbersHeard) heardOk += 1;
      if (numbersTranslated) translatedOk += 1;
    }
    rows.push(
      [
        line.language, line.to, csv(line.text), csv(heard), csv(result.translation), sttMs, llmMs, ttsMs, totalMs,
        numbersHeard, numbersTranslated, flagged, "", "",
      ].join(","),
    );
    console.log(`${index + 1}/${lines.length} ${line.language}>${line.to} total ${totalMs} ms: ${result.translation}`);
  } catch (error) {
    failures += 1;
    console.log(`${index + 1}/${lines.length} FAILED: ${String(error)}`);
  }
}

writeFileSync("eval/results.csv", `${rows.join("\n")}\n`);
console.log(`\nTurns: ${totals.length}/${lines.length} completed, ${failures} failed`);
console.log(`Latency: p50 ${percentile(totals, 0.5)} ms, p90 ${percentile(totals, 0.9)} ms`);
console.log(`Numbers transcribed as digits: ${heardOk}/${withNumbers}`);
console.log(`Numbers kept through translation: ${translatedOk}/${withNumbers}`);
console.log("Saved eval/results.csv. Ask native speakers to fill the two rating columns.");
