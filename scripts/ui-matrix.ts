/**
 * Every interface language on a small phone, a normal phone and a desktop, in
 * light and dark, plus the failure paths a real call runs into. Each run starts
 * a call, sends a typed turn, toggles the camera and ends with the summary,
 * checking for sideways scroll, clipped text, untranslated labels and console
 * errors. Screenshots go to tmp/ui/.
 *
 * Starts its own mock server on a free port, so no keys are needed. Build the
 * client first: pnpm build && pnpm exec tsx scripts/ui-matrix.ts
 */
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app";
import { MockSpeech, MockTranslator } from "../server/providers/mock";
import { LANGUAGES } from "../shared/protocol";
import type { LanguageCode } from "../shared/protocol";
import { STRINGS } from "../web/src/strings";
import { PHONE, Tab, frames, launchChrome, sleep, until } from "./cdp";
import type { Viewport } from "./cdp";

const app = createApp({
  config: { mock: true, allowedOrigins: [] },
  speech: new MockSpeech(),
  translator: new MockTranslator(),
  staticDir: "dist",
  limits: { rooms: 1000, voices: 1000 },
});
app.server.listen(0);
await once(app.server, "listening");
const BASE = `http://localhost:${(app.server.address() as AddressInfo).port}`;
const VIEWS: (Viewport & { name: string })[] = [
  { name: "small", width: 320, height: 640, mobile: true },
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false },
];
const CODES = LANGUAGES.map((l) => l.code);
const nameOf = (code: LanguageCode) => LANGUAGES.find((l) => l.code === code)!.name;

/**
 * Visible elements that spill out of the screen or cut their own text. Takes
 * the real screen width: in mobile emulation Chrome widens the layout
 * viewport to fit overflowing content, so innerWidth would hide the problem.
 */
const layoutProblems = (width: number) => `((innerWidth) => {
  const out = [];
  for (const el of document.querySelectorAll("button, label, h1, h2, p, strong, li, input, .bubble, .stage")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden") continue;
    const name = el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ").join(".") : "");
    const text = (el.innerText || el.value || "").trim().slice(0, 30);
    if (r.right > innerWidth + 1 || r.left < -1) out.push("off screen: " + name + " " + text);
    else if (el.scrollWidth > el.clientWidth + 2 && style.textOverflow !== "ellipsis" && el.tagName !== "INPUT")
      out.push("clipped: " + name + " " + text);
  }
  if (document.documentElement.scrollWidth > innerWidth) out.push("page scrolls sideways");
  if (window.innerWidth > innerWidth) out.push("layout wider than the screen");
  const self = document.querySelector(".stage .self")?.getBoundingClientRect();
  const caption = document.querySelector(".caption")?.getBoundingClientRect();
  if (self && caption && self.bottom > caption.top && self.left < caption.right) out.push("self view covers caption");
  return out;
})(${width})`;

const failures: string[] = [];
function check(ok: boolean, label: string): void {
  if (!ok) failures.push(label);
}

async function layout(tab: Tab, where: string, width: number): Promise<void> {
  const problems = await tab.eval<string[]>(layoutProblems(width));
  for (const problem of problems) failures.push(`${where}: ${problem}`);
}

async function startCall(
  view: Viewport,
  language: LanguageCode,
  name: string,
  relationship = "Friend",
): Promise<{ tab: Tab; code: string }> {
  const tab = await Tab.open(BASE, view);
  await tab.waitFor("Talk in your language");
  await tab.set('form input:not([type="radio"], [type="checkbox"])', name, "input");
  await tab.pick(".languages", nameOf(language));
  await tab.pick(".relations", relationship);
  await tab.clickText("Start call");
  await tab.waitFor(STRINGS[language].waiting);
  await sleep(200);
  const code = (await tab.eval<string>('document.querySelector(".room-code").getAttribute("aria-label")')).trim();
  return { tab, code };
}

async function join(code: string, language: LanguageCode, name: string, view: Viewport = PHONE): Promise<Tab> {
  const tab = await Tab.open(`${BASE}/?code=${code}`, view);
  await tab.waitFor("Call code");
  await tab.set("form label:nth-of-type(2) input", name, "input");
  await tab.pick(".languages", nameOf(language));
  await tab.clickText("Join call");
  return tab;
}

async function typedTurn(from: Tab, to: Tab, fromLang: LanguageCode, toLang: LanguageCode, text: string) {
  await from.eval(`document.querySelector(".composer") || document.querySelector(".talk-row .side").click()`);
  await until(from, '!!document.querySelector(".composer input")', "composer opens");
  await from.set(".composer input", text, "input");
  await from.eval(`document.querySelector(".composer .send").click()`);
  await to.waitFor(`[${nameOf(toLang)}] ${text}`, 8000);
  await from.waitFor(STRINGS[fromLang].hold, 10_000);
}

const chrome = await launchChrome();
mkdirSync("tmp/ui", { recursive: true });
try {
  // 0. The checker must see a real overflow, or its silence means nothing.
  {
    const probe = await Tab.open(BASE, VIEWS[0]);
    await probe.waitFor("Talk in your language");
    await probe.eval(`document.querySelector(".brand").append(Object.assign(document.createElement("button"), { textContent: "x".repeat(80) }))`);
    const seen = await probe.eval<string[]>(layoutProblems(VIEWS[0]!.width));
    check(seen.length > 0, "layout checker missed an injected overflow");
    probe.close();
    console.log(`ok   layout checker catches overflow (${seen.length} problems seen)`);
  }

  // 1. Every language, every screen size, both themes.
  for (const [i, language] of CODES.entries()) {
    for (const [j, base] of VIEWS.entries()) {
      const view = { ...base, dark: (i + j) % 2 === 1 };
      const where = `${language} ${base.name} ${view.dark ? "dark" : "light"}`;
      const text = STRINGS[language];
      const peerLang = CODES[(i + 5) % CODES.length]!;
      try {
        const { tab, code } = await startCall(view, language, "Lakshmi Narayanan");
        await layout(tab, `${where} waiting`, view.width);
        const peer = await join(code, peerLang, "Venkataraghavan Subramanian");
        await tab.waitFor(text.hold);
        check((await tab.eval<string>('document.querySelector(".talk-label").innerText')) === text.hold, `${where}: talk label not localized`);
        await layout(tab, `${where} call`, view.width);

        await typedTurn(tab, peer, language, peerLang, "hello");
        await typedTurn(peer, tab, peerLang, language, "fine thanks");
        await tab.eval(`document.querySelector(".camera").click()`);
        await until(tab, frames(".stage .self"), `${where}: self view`);
        await until(peer, frames(".stage .remote"), `${where}: peer sees video`);
        await layout(tab, `${where} video`, view.width);
        await tab.shot(`ui/${language}-${base.name}-${view.dark ? "dark" : "light"}`);
        await tab.eval(`document.querySelector(".camera").click()`);

        await tab.eval(`document.querySelector(".end").click()`);
        await tab.waitFor(text.endConfirm);
        await layout(tab, `${where} end confirm`, view.width);
        await tab.eval(`document.querySelector(".end").click()`);
        // Card titles are uppercased in CSS, which innerText reflects, so match textContent.
        await until(
          tab,
          `[...document.querySelectorAll(".card h2")].some((h) => h.textContent === ${JSON.stringify(text.keyPoints)})`,
          `${where}: summary`,
        );
        await layout(tab, `${where} summary`, view.width);
        for (const t of [tab, peer]) check(t.errors.length === 0, `${where}: console errors ${t.errors.join("; ")}`);
        tab.close();
        peer.close();
        console.log(`ok   ${where}`);
      } catch (error) {
        failures.push(`${where}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
        console.log(`FAIL ${where}`);
      }
    }
  }

  // 2. Failure paths.
  const en = STRINGS["en-IN"];
  {
    const tab = await join("ZZZZZZ", "en-IN", "Asha");
    await tab.waitFor("No call found with that code.");
    tab.close();
    console.log("ok   unknown code is refused");
  }
  {
    const { tab, code } = await startCall(PHONE, "en-IN", "Asha");
    const peer = await join(code, "hi-IN", "Ravi");
    await tab.waitFor(en.hold);
    const third = await join(code, "ta-IN", "Kumar");
    await third.waitFor("This call is already full.");
    third.close();
    console.log("ok   third person is refused");

    // Hold to talk with the keyboard.
    await tab.eval(`document.querySelector(".talk").focus()`);
    await tab.call("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await tab.waitFor(en.speaking);
    await sleep(900);
    await tab.call("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await peer.waitFor("[Hindi] Mock speech", 8000);
    await tab.waitFor(en.hold, 10_000);
    console.log("ok   space bar works as hold to talk");

    // Blank and oversized typed turns.
    await tab.eval(`document.querySelector(".talk-row .side").click()`);
    await until(tab, '!!document.querySelector(".composer input")', "composer opens");
    await tab.set(".composer input", "   ", "input");
    check(await tab.eval<boolean>('document.querySelector(".composer .send").disabled'), "blank message can be sent");
    const max = await tab.eval<number>('document.querySelector(".composer input").maxLength');
    check(max === 500, `typed limit is ${max}, not 500`);
    console.log("ok   blank message blocked, 500 character limit");

    // The other person drops off.
    peer.close();
    await tab.waitFor(en.reconnecting, 8000);
    check(await tab.eval<boolean>('document.querySelector(".talk").disabled'), "talk allowed with peer offline");
    await tab.set(".composer input", "anyone there", "input");
    check(await tab.eval<boolean>('document.querySelector(".composer .send").disabled'), "typing allowed with peer offline");
    console.log("ok   peer offline locks talking and typing");
    tab.close();
  }
  {
    // Chrome's fake media flag ignores permission settings, so the refusal is
    // made inside the page, where the app's own error handling sees it.
    const refuse = (kind: "audio" | "video") => `(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) =>
        c && c.${kind} ? Promise.reject(new DOMException("Permission denied", "NotAllowedError")) : real(c);
    })()`;

    const { tab, code } = await startCall(PHONE, "en-IN", "Asha");
    const peer = await join(code, "hi-IN", "Ravi");
    await tab.waitFor(en.hold);
    await tab.eval(refuse("video"));
    await tab.eval(`document.querySelector(".camera").click()`);
    await tab.waitFor(en.cameraBlocked);
    check(!(await tab.eval<boolean>('!!document.querySelector(".stage")')), "video stage shown with camera refused");
    await typedTurn(tab, peer, "en-IN", "hi-IN", "voice still works");
    console.log("ok   refused camera shows a notice, call continues");
    tab.close();
    peer.close();

    const denied = await Tab.open(BASE);
    await denied.waitFor("Talk in your language");
    await denied.eval(refuse("audio"));
    await denied.set('form input:not([type="radio"], [type="checkbox"])', "Asha", "input");
    await denied.clickText("Start call");
    await denied.waitFor("Microphone blocked");
    console.log("ok   refused mic explains what to do");
    denied.close();
  }
} catch (error) {
  failures.push(`failure paths: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
} finally {
  chrome.kill();
  app.close();
}

console.log(failures.length ? `\nFAILURES (${failures.length}):\n- ${failures.join("\n- ")}` : "\nPASS");
process.exit(failures.length ? 1 : 0);
