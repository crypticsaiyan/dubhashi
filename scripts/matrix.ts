/**
 * Live matrix: every language speaks and listens through the real server,
 * with real Prisma, Timbre and the LLM.
 *
 * Room i: caller speaks L[i], joiner speaks L[i+3]. The relationship rotates
 * and genders alternate. In each room the caller talks (spoken through STT),
 * the joiner replies (typed), then the call ends with summaries. Room 0's
 * caller uses a cloned voice.
 *
 * Mic audio is Timbre speech, so no real recordings are involved. What the
 * listener receives is fed back through Prisma to check it is intelligible.
 * Results go to eval/matrix.csv.
 *
 *   pnpm exec tsx scripts/matrix.ts            all 10 rooms
 *   ROOMS=0,4 pnpm exec tsx scripts/matrix.ts  a subset
 */
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { LANGUAGES, MIC_SAMPLE_RATE, PLAYBACK_SAMPLE_RATE, RELATIONSHIPS } from "../shared/protocol";
import type { ClientMessage, Gender, LanguageCode, ServerMessage } from "../shared/protocol";
import { createApp } from "../server/app";
import { pcmToWav } from "../server/audio";
import { loadConfig } from "../server/config";
import { GnaniSpeech } from "../server/providers/gnani";
import { LlmTranslator } from "../server/providers/llm";
import { extractNumbers } from "../server/text";

/** A: has a number, so the guard and fact check run. B: plain speech. */
const LINES: Record<LanguageCode, [string, string]> = {
  "hi-IN": ["मुझे दिन में 2 बार यह दवा लेनी है।", "आज मौसम बहुत अच्छा है, चलो बाहर चलते हैं।"],
  "bn-IN": ["আমার ছেলের বয়স 12 বছর।", "আপনি কি আমাকে স্টেশনের রাস্তা বলতে পারবেন?"],
  "ta-IN": ["வாடகை மாதம் 8000 ரூபாய்.", "நாளை காலை நான் வேலைக்கு வருவேன்."],
  "te-IN": ["నాకు 3 రోజులుగా జ్వరం ఉంది.", "మీ ఆరోగ్యం ఎలా ఉంది అమ్మా?"],
  "mr-IN": ["मला 500 रुपये उद्या हवे आहेत.", "तुम्ही जेवण केलं का?"],
  "kn-IN": ["ನನ್ನ ಸಂಬಳ ತಿಂಗಳಿಗೆ 15000 ರೂಪಾಯಿ.", "ಇವತ್ತು ತುಂಬಾ ಮಳೆ ಬರುತ್ತಿದೆ."],
  "ml-IN": ["ഈ ഗുളിക ദിവസം 2 തവണ കഴിക്കണം.", "നിങ്ങൾ എവിടെ നിന്നാണ് വരുന്നത്?"],
  "gu-IN": ["મારી દીકરીની પરીક્ષા 25 તારીખે છે.", "તમે ચા પીશો?"],
  "pa-IN": ["ਮੈਂ ਸ਼ਾਮ 6 ਵਜੇ ਘਰ ਆਵਾਂਗਾ।", "ਤੁਹਾਡਾ ਬਹੁਤ ਧੰਨਵਾਦ ਜੀ।"],
  "en-IN": ["Please take 1 tablet after dinner for 5 days.", "How is your mother feeling today?"],
};

/** Unicode block for each language's script. */
const SCRIPT: Record<LanguageCode, RegExp> = {
  "hi-IN": /[ऀ-ॿ]/,
  "mr-IN": /[ऀ-ॿ]/,
  "bn-IN": /[ঀ-৿]/,
  "pa-IN": /[਀-੿]/,
  "gu-IN": /[઀-૿]/,
  "ta-IN": /[஀-௿]/,
  "te-IN": /[ఀ-౿]/,
  "kn-IN": /[ಀ-೿]/,
  "ml-IN": /[ഀ-ൿ]/,
  "en-IN": /[A-Za-z]/,
};

const CODES = LANGUAGES.map((l) => l.code);
const config = loadConfig();
const speech = new GnaniSpeech(config);
const translator = new LlmTranslator(config);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Share of letters written in the expected script. */
function scriptShare(text: string, language: LanguageCode): number {
  const letters = [...text].filter((c) => /\p{L}|\p{M}/u.test(c));
  if (!letters.length) return 0;
  return letters.filter((c) => SCRIPT[language].test(c)).length / letters.length;
}

/** Character error rate after dropping spaces and punctuation. */
function cer(reference: string, hypothesis: string): number {
  const clean = (s: string) => [...s.toLowerCase().replace(/[\s\p{P}]/gu, "")];
  const a = clean(reference);
  const b = clean(hypothesis);
  if (!a.length) return b.length ? 1 : 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]! / a.length;
}

function to16k(pcm: Buffer): Buffer {
  const ratio = PLAYBACK_SAMPLE_RATE / MIC_SAMPLE_RATE;
  const samples = Math.floor(pcm.length / 2 / ratio);
  const out = Buffer.alloc(samples * 2);
  const last = pcm.length / 2 - 1;
  for (let i = 0; i < samples; i++) {
    const p = i * ratio;
    const k = Math.floor(p);
    const a = pcm.readInt16LE(k * 2);
    const b = pcm.readInt16LE(Math.min(k + 1, last) * 2);
    out.writeInt16LE(Math.round(a + (b - a) * (p - k)), i * 2);
  }
  return out;
}

async function tts(text: string, language: LanguageCode, gender: Gender): Promise<Buffer> {
  const parts: Buffer[] = [];
  await speech.synthesize({ text, language, voice: { gender } }, (b) => parts.push(b));
  return Buffer.concat(parts);
}

async function transcribe(pcm16k: Buffer, language: LanguageCode): Promise<string> {
  const stt = speech.openStt({ language, onError: (e) => console.error("  stt", e.message) });
  for (let o = 0; o < pcm16k.length; o += 1024) stt.write(pcm16k.subarray(o, o + 1024));
  return stt.finish();
}

type Message<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

class Client {
  readonly seen: ServerMessage[] = [];
  private audio: Buffer[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data, binary) => {
      if (binary) this.audio.push(data as Buffer);
      else this.seen.push(JSON.parse(data.toString()) as ServerMessage);
    });
  }
  static async open(url: string): Promise<Client> {
    const client = new Client(new WebSocket(url));
    await once(client.ws, "open");
    return client;
  }
  send(message: ClientMessage) {
    this.ws.send(JSON.stringify(message));
  }
  takeAudio(): Buffer {
    return Buffer.concat(this.audio.splice(0));
  }
  async wait<T extends ServerMessage["type"]>(
    type: T,
    ms = 45_000,
    match: (m: Message<T>) => boolean = () => true,
  ): Promise<Message<T>> {
    const end = Date.now() + ms;
    for (;;) {
      const i = this.seen.findIndex((m) => m.type === type && match(m as Message<T>));
      if (i >= 0) return this.seen.splice(i, 1)[0] as Message<T>;
      const error = this.seen.find((m) => m.type === "error");
      if (error) throw new Error(`server error: ${JSON.stringify(error)}`);
      if (Date.now() > end) {
        throw new Error(`timed out on ${type}; saw ${this.seen.map((m) => m.type).join(",")}`);
      }
      await sleep(20);
    }
  }
}

interface Row {
  room: number;
  mode: "spoken" | "typed";
  from: LanguageCode;
  to: LanguageCode;
  relationship: string;
  voice: string;
  source: string;
  heard: string;
  sttCer: number | "";
  translation: string;
  scriptOk: boolean;
  numbersKept: boolean;
  confirmed: boolean;
  audioSec: number;
  roundTrip: string;
  roundTripCer: number;
  backTranslation: string;
  totalMs: number | "";
  pass: boolean;
  note: string;
}

const rows: Row[] = [];
const app = createApp({ config, speech, translator });
app.server.listen(0);
await once(app.server, "listening");
const port = (app.server.address() as AddressInfo).port;
const url = `ws://127.0.0.1:${port}/ws`;

async function cloneVoice(language: LanguageCode): Promise<string> {
  const sample = `${LINES[language][1]} ${LINES[language][0]} ${LINES[language][1]}`;
  const wav = pcmToWav(to16k(await tts(sample, language, "female")), MIC_SAMPLE_RATE);
  const response = await fetch(`http://127.0.0.1:${port}/api/voice`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav", "X-Voice-Consent": "yes" },
    body: new Uint8Array(wav),
  });
  const body = (await response.json()) as { voiceId?: string; error?: string };
  if (!body.voiceId) throw new Error(`clone failed: ${body.error}`);
  return body.voiceId;
}

async function turn(
  room: number,
  relationship: string,
  speaker: Client,
  listener: Client,
  from: LanguageCode,
  to: LanguageCode,
  gender: Gender,
  voice: string,
  mode: "spoken" | "typed",
  source: string,
): Promise<void> {
  let heard = source;
  let sttCer: number | "" = "";
  if (mode === "spoken") {
    const mic = to16k(await tts(source, from, gender));
    speaker.send({ type: "talk_start" });
    await speaker.wait("room", 5000, (m) => m.phase === "speaking");
    // Real time, as a phone would send it.
    for (let o = 0; o < mic.length; o += 1024) {
      speaker.ws.send(mic.subarray(o, o + 1024));
      await sleep(32);
    }
    speaker.send({ type: "talk_end" });
  } else {
    speaker.send({ type: "text_turn", text: source });
  }

  const mine = await speaker.wait("my_turn");
  heard = mine.text;
  if (mode === "spoken") sttCer = cer(source, heard);
  // Either the speaker is asked to confirm, or the listener gets it directly.
  let confirmed = false;
  for (const end = Date.now() + 45_000; ; await sleep(20)) {
    const ask = speaker.seen.find((m) => m.type === "confirm_needed");
    if (ask?.type === "confirm_needed") {
      confirmed = true;
      speaker.send({ type: "confirm", turnId: ask.turnId, ok: true });
      break;
    }
    if (listener.seen.some((m) => m.type === "peer_turn")) break;
    if (Date.now() > end) throw new Error("no confirm or delivery");
  }
  const peer = await listener.wait("peer_turn");
  await listener.wait("audio_end", 60_000);
  const pcm = listener.takeAudio();
  const metrics = await speaker.wait("metrics", 5000, (m) => m.metrics.turnId === peer.turnId).catch(() => null);
  listener.send({ type: "playback_done", turnId: peer.turnId });
  await listener.wait("room", 10_000, (m) => m.phase === "idle");
  const back = await speaker.wait("they_heard", 30_000).catch(() => null);

  const roundTrip = pcm.length ? await transcribe(to16k(pcm), to) : "";
  const roundTripCer = cer(peer.text, roundTrip);
  const sourceNumbers = extractNumbers(heard);
  const numbersKept = sourceNumbers.every((n) => extractNumbers(peer.text).includes(n));
  const scriptOk = scriptShare(peer.text, to) >= 0.6;
  const audioSec = pcm.length / 2 / PLAYBACK_SAMPLE_RATE;
  const notes: string[] = [];
  if (!heard.trim()) notes.push("empty transcript");
  if (!scriptOk) notes.push("wrong script");
  if (!numbersKept) notes.push(`numbers ${sourceNumbers.join("/")} lost`);
  if (audioSec < 0.5) notes.push("no audio");
  if (roundTripCer > 0.5) notes.push("audio unintelligible");
  if (!back) notes.push("no back-translation");
  const pass = notes.length === 0;
  rows.push({
    room,
    mode,
    from,
    to,
    relationship,
    voice,
    source,
    heard,
    sttCer,
    translation: peer.text,
    scriptOk,
    numbersKept,
    confirmed,
    audioSec: Math.round(audioSec * 10) / 10,
    roundTrip,
    roundTripCer: Math.round(roundTripCer * 100) / 100,
    backTranslation: back?.text ?? "",
    totalMs: metrics?.metrics.totalMs ?? "",
    pass,
    note: notes.join("; "),
  });
  const cerText = sttCer === "" ? "typed" : `stt cer ${sttCer.toFixed(2)}`;
  console.log(
    `  ${pass ? "ok  " : "FAIL"} ${mode.padEnd(6)} ${from}->${to} ${voice.padEnd(13)} ${cerText.padEnd(13)}` +
      ` rt cer ${roundTripCer.toFixed(2)} ${audioSec.toFixed(1)}s ${metrics?.metrics.totalMs ?? "-"}ms` +
      `${confirmed ? " confirmed" : ""}${notes.length ? ` (${notes.join("; ")})` : ""}`,
  );
  console.log(`       heard: ${heard}\n       said : ${peer.text}\n       rt   : ${roundTrip}`);
}

const only = process.env.ROOMS?.split(",").map(Number);
const failures: string[] = [];
for (let i = 0; i < CODES.length; i++) {
  if (only && !only.includes(i)) continue;
  const callerLang = CODES[i]!;
  const joinerLang = CODES[(i + 3) % CODES.length]!;
  const relationship = RELATIONSHIPS[i % RELATIONSHIPS.length]!.id;
  const callerGender: Gender = i % 2 ? "male" : "female";
  const joinerGender: Gender = i % 2 ? "female" : "male";
  console.log(`\n# room ${i}: ${callerLang} (${callerGender}) with ${joinerLang} (${joinerGender}), ${relationship}`);
  try {
    const voiceId = i === 0 ? await cloneVoice(callerLang) : undefined;
    const caller = await Client.open(url);
    caller.send({ type: "create", relationship, name: "Caller", language: callerLang, gender: callerGender, voiceId });
    const { code } = await caller.wait("joined");
    const joiner = await Client.open(url);
    joiner.send({ type: "join", code, name: "Joiner", language: joinerLang, gender: joinerGender });
    await joiner.wait("joined");
    await caller.wait("room", 5000, (m) => m.phase === "idle");

    const callerVoice = voiceId ? "cloned" : `stock ${callerGender}`;
    await turn(i, relationship, caller, joiner, callerLang, joinerLang, callerGender, callerVoice, "spoken", LINES[callerLang][0]);
    await turn(i, relationship, joiner, caller, joinerLang, callerLang, joinerGender, `stock ${joinerGender}`, "typed", LINES[joinerLang][1]);
    if (voiceId && caller.seen.some((m) => m.type === "notice" && m.code === "voice_fallback")) {
      failures.push(`room ${i}: cloned voice fell back to stock`);
    }

    caller.send({ type: "end_call" });
    for (const [who, client, language] of [["caller", caller, callerLang], ["joiner", joiner, joinerLang]] as const) {
      const { summary } = await client.wait("summary", 60_000);
      const text = [...summary.keyPoints, ...summary.nextSteps].join(" ");
      const ok = summary.keyPoints.length > 0 && scriptShare(text, language) >= 0.6;
      console.log(`  ${ok ? "ok  " : "FAIL"} summary ${who} ${language}: ${text.slice(0, 120)}`);
      if (!ok) failures.push(`room ${i}: ${who} summary empty or wrong script`);
    }
    caller.takeAudio();
    caller.send({ type: "summary_audio" });
    await caller.wait("audio_end", 60_000);
    const summarySec = caller.takeAudio().length / 2 / PLAYBACK_SAMPLE_RATE;
    console.log(`  ${summarySec > 1 ? "ok  " : "FAIL"} summary audio ${summarySec.toFixed(1)}s`);
    if (summarySec <= 1) failures.push(`room ${i}: no summary audio`);
    caller.ws.close();
    joiner.ws.close();
  } catch (error) {
    console.error(`  FAIL room ${i}:`, error instanceof Error ? error.message : error);
    failures.push(`room ${i}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const header = Object.keys(rows[0] ?? {}) as (keyof Row)[];
const csv = [header.join(","), ...rows.map((r) => header.map((k) => JSON.stringify(r[k] ?? "")).join(","))];
writeFileSync("eval/matrix.csv", csv.join("\n") + "\n");
failures.push(...rows.filter((r) => !r.pass).map((r) => `room ${r.room} ${r.mode} ${r.from}->${r.to}: ${r.note}`));

const spoken = rows.filter((r) => r.mode === "spoken" && typeof r.totalMs === "number");
const totals = spoken.map((r) => r.totalMs as number).sort((a, b) => a - b);
console.log(`\n${rows.filter((r) => r.pass).length}/${rows.length} turns passed`);
if (totals.length) {
  console.log(`spoken release to first audio: p50 ${totals[Math.floor(totals.length / 2)]}ms, max ${totals.at(-1)}ms`);
}
console.log(failures.length ? `FAILURES:\n- ${failures.join("\n- ")}` : "PASS");
app.close();
process.exit(failures.length ? 1 : 0);
