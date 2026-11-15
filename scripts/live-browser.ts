/**
 * Real speech through the real browser mic, with live Prisma, Timbre and the
 * LLM. Chrome loops a Timbre-made WAV as its microphone, so this covers what
 * the socket matrix skips: the mic worklet's resampling and framing, and
 * playback in the listener's browser.
 *
 * The file loops, so the talk button is held for two loops: at least one
 * whole sentence is always inside the capture.
 *
 *   pnpm build && pnpm exec tsx scripts/live-browser.ts
 *
 * Set TARGET to a deployed URL to test that instead of an in-process server.
 */
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { LANGUAGES, PLAYBACK_SAMPLE_RATE } from "../shared/protocol";
import type { LanguageCode } from "../shared/protocol";
import { createApp } from "../server/app";
import { pcmToWav } from "../server/audio";
import { loadConfig } from "../server/config";
import { GnaniSpeech } from "../server/providers/gnani";
import { LlmTranslator } from "../server/providers/llm";
import { STRINGS } from "../web/src/strings";
import { Tab, launchChrome, sleep, until } from "./cdp";

const CASES: { speaker: LanguageCode; listener: LanguageCode; text: string; number: string }[] = [
  { speaker: "ta-IN", listener: "hi-IN", text: "வாடகை மாதம் 8000 ரூபாய்.", number: "8000" },
  { speaker: "bn-IN", listener: "en-IN", text: "আমার ছেলের বয়স 12 বছর।", number: "12" },
  { speaker: "en-IN", listener: "kn-IN", text: "My appointment is on the 25th at 4 pm.", number: "25" },
];
const nameOf = (code: LanguageCode) => LANGUAGES.find((l) => l.code === code)!.name;

const config = loadConfig();
const speech = new GnaniSpeech(config);
const target = process.env.TARGET?.replace(/\/$/, "");
const app = target ? null : createApp({ config, speech, translator: new LlmTranslator(config), staticDir: "dist" });
if (app) {
  app.server.listen(0);
  await once(app.server, "listening");
}
const BASE = target ?? `http://localhost:${(app!.server.address() as AddressInfo).port}`;
mkdirSync("tmp", { recursive: true });

const failures: string[] = [];
for (const c of CASES) {
  const where = `${c.speaker}->${c.listener}`;
  const parts: Buffer[] = [];
  await speech.synthesize({ text: c.text, language: c.speaker, voice: { gender: "female" } }, (b) => parts.push(b));
  // A pause after the sentence, as a person would leave.
  const pcm = Buffer.concat([...parts, Buffer.alloc(PLAYBACK_SAMPLE_RATE * 2 * 1.2)]);
  const file = resolve(`tmp/mic-${c.speaker}.wav`);
  writeFileSync(file, pcmToWav(pcm, PLAYBACK_SAMPLE_RATE));
  const loopMs = (pcm.length / 2 / PLAYBACK_SAMPLE_RATE) * 1000;

  const chrome = await launchChrome([`--use-file-for-fake-audio-capture=${file}`]);
  try {
    const a = await Tab.open(BASE);
    await a.waitFor("Talk in your language");
    await a.set('form input:not([type="radio"], [type="checkbox"])', "Meena", "input");
    await a.pick(".languages", nameOf(c.speaker));
    await a.pick(".relations", "Friend");
    await a.clickText("Start call");
    await a.waitFor(STRINGS[c.speaker].waiting);
    await until(a, '!!document.querySelector(".room-code")?.getAttribute("aria-label")', "room code");
    const code = (await a.eval<string>('document.querySelector(".room-code").getAttribute("aria-label")')).trim();
    const b = await Tab.open(`${BASE}/?code=${code}`);
    await b.waitFor("Call code");
    await b.set("form label:nth-of-type(2) input", "Arjun", "input");
    await b.pick(".languages", nameOf(c.listener));
    await b.clickText("Join call");
    await a.waitFor(STRINGS[c.speaker].hold, 10_000);

    await a.hold(Math.min(2 * loopMs + 300, 25_000));
    await until(a, '!!document.querySelector(".bubble.mine p")', `${where}: transcript`, 20_000);
    const heard = await a.eval<string>('document.querySelector(".bubble.mine p").innerText');
    await until(b, '!!document.querySelector(".bubble:not(.mine):not(.typing) p")', `${where}: translation`, 20_000);
    const said = await b.eval<string>('document.querySelector(".bubble:not(.mine):not(.typing) p").innerText');
    // Playback finishing in B's browser is what frees A's button.
    await a.waitFor(STRINGS[c.speaker].hold, 30_000);
    const timing = await a.eval<string>('document.querySelector(".timing")?.innerText ?? ""');

    const numberHeard = heard.includes(c.number);
    console.log(`${numberHeard ? "ok  " : "WARN"} ${where}`);
    console.log(`     mic → Prisma : ${heard}`);
    console.log(`     listener got : ${said}`);
    console.log(`     timing       : ${timing.replace(/\n/g, " ")}`);
    if (!heard.trim()) failures.push(`${where}: empty transcript`);
    if (!said.trim()) failures.push(`${where}: nothing delivered`);
    if (!numberHeard) console.log(`     number ${c.number} not in transcript (may be spelled out)`);
    for (const [name, tab] of [["speaker", a], ["listener", b]] as const) {
      if (tab.errors.length) failures.push(`${where} ${name} console errors: ${tab.errors.join("; ")}`);
    }
    await a.shot(`live-${c.speaker}-speaker`);
    await b.shot(`live-${c.speaker}-listener`);
  } catch (error) {
    failures.push(`${where}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    console.log(`FAIL ${where}`);
  } finally {
    chrome.kill();
    await sleep(500);
  }
}

app?.close();
console.log(failures.length ? `\nFAILURES:\n- ${failures.join("\n- ")}` : "\nPASS");
process.exit(failures.length ? 1 : 0);
