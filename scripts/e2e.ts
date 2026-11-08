/**
 * Drives a full call in two real Chrome tabs with a fake microphone, against a
 * server started with MOCK_AI=1. Covers what the socket tests cannot: the mic
 * worklet, the hold button, the confirm card, playback and the summary screen.
 *
 *   MOCK_AI=1 pnpm start   then   pnpm exec tsx scripts/e2e.ts
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { STRINGS } from "../web/src/strings";

const bn = STRINGS["bn-IN"];
const ml = STRINGS["ml-IN"];

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const PORT = 9333;
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome-stable";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Tab {
  private id = 0;
  private pending = new Map<number, (value: { result?: unknown; error?: unknown }) => void>();
  readonly errors: string[] = [];

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.id) this.pending.get(message.id)?.(message);
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails.exception?.description ?? "exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.errors.push(JSON.stringify(message.params.args.map((arg: { value?: unknown }) => arg.value)));
      }
    });
  }

  static async open(url: string): Promise<Tab> {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    const { webSocketDebuggerUrl } = (await response.json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((resolve) => ws.once("open", resolve));
    const tab = new Tab(ws);
    await tab.call("Runtime.enable");
    await tab.call("Page.enable");
    await tab.call("Emulation.setDeviceMetricsOverride", {
      width: 412, height: 915, deviceScaleFactor: 2, mobile: true,
    });
    return tab;
  }

  call(method: string, params: object = {}): Promise<{ result?: unknown; error?: unknown }> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  async eval<T>(expression: string): Promise<T> {
    const reply = (await this.call("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    })) as { result?: { result?: { value?: T }; exceptionDetails?: unknown } };
    if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails));
    return reply.result?.result?.value as T;
  }

  text = () => this.eval<string>("document.body.innerText");

  async waitFor(needle: string, timeoutMs = 6000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await this.text()).includes(needle)) return;
      await sleep(80);
    }
    throw new Error(`Timed out waiting for "${needle}". Page says:\n${await this.text()}`);
  }

  async set(selector: string, value: string, event: "input" | "change"): Promise<void> {
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
    })()`);
  }

  async clickText(label: string): Promise<void> {
    await this.eval(`[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)}).click()`);
  }

  async pick(group: string, label: string): Promise<void> {
    await this.eval(`[...document.querySelectorAll(${JSON.stringify(group + " .choice")})]
      .find((l) => l.innerText.includes(${JSON.stringify(label)})).querySelector("input").click()`);
  }

  async hold(ms: number): Promise<void> {
    await this.call("Page.bringToFront");
    const box = await this.eval<{ x: number; y: number }>(`(() => {
      const r = document.querySelector(".talk").getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    const mouse = { ...box, button: "left", clickCount: 1 };
    await this.call("Input.dispatchMouseEvent", { type: "mousePressed", ...mouse });
    await sleep(ms);
    await this.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse });
  }

  async shot(name: string): Promise<void> {
    await this.call("Page.bringToFront");
    await sleep(150);
    const reply = (await this.call("Page.captureScreenshot", { format: "png" })) as { result?: { data?: string } };
    writeFileSync(`tmp/${name}.png`, Buffer.from(reply.result?.data ?? "", "base64"));
  }

  overflow = () => this.eval<boolean>("document.documentElement.scrollWidth > innerWidth");
}

async function until(tab: Tab, expression: string, label: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await tab.eval<boolean>(expression))) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(100);
  }
}

const frames = (selector: string) =>
  `(document.querySelector("${selector}")?.videoWidth ?? 0) > 0`;

mkdirSync("tmp", { recursive: true });
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "dubhashi-e2e-"))}`,
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

let failed = false;
try {
  for (let i = 0; i < 50; i++) {
    const up = await fetch(`http://127.0.0.1:${PORT}/json/version`).catch(() => null);
    if (up?.ok) break;
    await sleep(100);
  }

  const patient = await Tab.open(BASE);
  await patient.waitFor("Talk in your language");
  await patient.shot("1-start");
  await patient.set('form input:not([type="radio"], [type="checkbox"])', "Asha", "input");
  await patient.pick(".languages", "Bengali");
  await patient.eval(`document.querySelector('.toggle input').click()`);
  await patient.clickText("Start call");
  await patient.waitFor("Speak in your own voice");
  const locked = await patient.eval<boolean>(
    `[...document.querySelectorAll("button")].find((b) => b.innerText === "Record").disabled`,
  );
  if (!locked) throw new Error("Recording allowed without consent");
  await patient.eval(`document.querySelector('.check input').click()`);
  await patient.clickText("Record");
  for (let i = 0; i < 100; i++) {
    const shown = await patient.eval<string>('document.querySelector(".recorder-center strong")?.innerText ?? ""');
    if (parseInt(shown) >= 6) break;
    await sleep(100);
  }
  await patient.shot("1b-voice");
  await patient.clickText("Finish");
  await patient.waitFor(bn.waiting);
  console.log("voice enrolled with consent");
  await sleep(300);
  const code = (await patient.eval<string>('document.querySelector(".room-code").getAttribute("aria-label")')).trim();
  console.log("room", code);
  await patient.shot("2-waiting");

  const doctor = await Tab.open(`${BASE}/?code=${code}`);
  await doctor.waitFor("Call code");
  await doctor.set('form label:nth-of-type(2) input', "Dr Nair", "input");
  await doctor.pick(".languages", "Malayalam");
  await doctor.clickText("Join call");
  await doctor.waitFor("Asha");
  await patient.waitFor("Dr Nair");
  await patient.waitFor("কথা বলতে চেপে ধরুন");
  await doctor.waitFor("സംസാരിക്കാൻ അമർത്തിപ്പിടിക്കുക");
  console.log("both in call, labels localized");
  await patient.shot("2b-call-empty");

  await doctor.hold(1200);
  await doctor.waitFor("ഇത് ശരിയാണോ?");
  await doctor.waitFor("500");
  console.log("mic reached server, confirm card shown to speaker");
  await doctor.shot("3-confirm");
  const before = await patient.text();
  if (before.includes("500")) throw new Error("Listener got the dose before confirmation");

  await doctor.clickText("അതെ");
  await patient.waitFor("[Bengali]");
  await doctor.waitFor("അവർ കേട്ടത്");
  console.log("translation delivered, back-translation shown");

  // The talk button only frees up after the browser plays the audio and reports it.
  await patient.waitFor(bn.hold);
  await patient.clickText(bn.replay);
  await patient.waitFor(bn.playing);
  console.log("replay plays the heard turn again");
  await patient.waitFor(bn.replay, 8000);
  const played = await patient.eval<boolean>('!document.querySelector(".talk").disabled');
  if (!played) throw new Error("Talk button still locked after playback");
  console.log("playback finished, button released");
  await patient.shot("4-listener");
  await doctor.shot("5-speaker");

  await patient.hold(900);
  await patient.waitFor("এটা কি ঠিক?");
  await patient.clickText("আবার বলুন");
  await patient.waitFor("কথা বলতে চেপে ধরুন");
  console.log("say again cancels the turn");

  await patient.eval(`document.querySelector(".camera").click()`);
  await until(patient, frames(".stage .self"), "patient self view");
  await until(doctor, frames(".stage .remote"), "doctor sees patient video");
  await doctor.eval(`document.querySelector(".camera").click()`);
  await until(patient, frames(".stage .remote"), "patient sees doctor video");
  const caption = await patient.eval<string>('document.querySelector(".caption")?.innerText ?? ""');
  if (!caption.includes("[Bengali]")) throw new Error(`Caption missing translation: ${caption}`);
  console.log("video both ways, caption shows translation");
  await patient.shot("5b-video-patient");
  await doctor.shot("5c-video-doctor");
  await patient.eval(`document.querySelector(".camera").click()`);
  await until(doctor, '!!document.querySelector(".stage .remote.off")', "doctor sees camera off");
  console.log("camera off reaches peer");

  await patient.waitFor(bn.hold);
  await patient.eval(`document.querySelector(".talk-row .side").click()`);
  await patient.set(".composer input", "my head hurts", "input");
  await patient.eval(`document.querySelector(".composer .send").click()`);
  await doctor.waitFor("[Malayalam] my head hurts");
  await doctor.waitFor(ml.hold, 8000);
  console.log("typed turn delivered");
  await patient.shot("5d-typed");

  await doctor.eval("location.reload()");
  await doctor.waitFor(ml.rejoin);
  await doctor.shot("5e-rejoin");
  await doctor.clickText(ml.rejoin);
  await doctor.waitFor(ml.hold);
  if (!(await doctor.text()).includes("[Malayalam] my head hurts")) throw new Error("Transcript lost on rejoin");
  await until(patient, '!document.querySelector(".stage")', "stale video cleared after peer reload");
  console.log("reloaded tab rejoins with transcript, stale video cleared");
  await doctor.eval(`document.querySelector(".camera").click()`);
  await until(patient, frames(".stage .remote"), "video reconnects after reload");
  await doctor.eval(`document.querySelector(".camera").click()`);
  console.log("video reconnects after reload");

  await doctor.eval(`document.querySelector(".end").click()`);
  await doctor.waitFor(ml.endConfirm);
  if ((await patient.text()).includes(bn.summaryTitle)) throw new Error("One tap ended the call");
  await doctor.eval(`document.querySelector(".end").click()`);
  await patient.waitFor(bn.summaryTitle);
  await doctor.waitFor(ml.summaryTitle);
  await patient.waitFor("মূল কথা");
  await patient.shot("6-summary");
  await patient.clickText("শুনুন");
  await sleep(300);
  console.log("summary shown to both");

  for (const [name, tab] of [["patient", patient], ["doctor", doctor]] as const) {
    if (await tab.overflow()) throw new Error(`${name} page scrolls sideways`);
    if (tab.errors.length) throw new Error(`${name} console errors: ${tab.errors.join("; ")}`);
  }
  console.log("PASS");
} catch (error) {
  failed = true;
  console.error("FAIL", error);
} finally {
  chrome.kill();
}
process.exit(failed ? 1 : 0);
