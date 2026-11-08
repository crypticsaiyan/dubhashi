/** Minimal Chrome DevTools Protocol driver shared by the browser test scripts. */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

export const PORT = Number(process.env.CDP_PORT ?? 9333);
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome-stable";

/** Starts headless Chrome with a fake camera and mic, and waits for it. */
export async function launchChrome(extraArgs: string[] = []): Promise<ChildProcess> {
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "dubhashi-cdp-"))}`,
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    ...extraArgs,
    "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    const up = await fetch(`http://127.0.0.1:${PORT}/json/version`).catch(() => null);
    if (up?.ok) break;
    await sleep(100);
  }
  return chrome;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Viewport {
  width: number;
  height: number;
  mobile: boolean;
  dark?: boolean;
}

export const PHONE: Viewport = { width: 412, height: 915, mobile: true };

export class Tab {
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

  static async open(url: string, view: Viewport = PHONE): Promise<Tab> {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    const { webSocketDebuggerUrl } = (await response.json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((resolve) => ws.once("open", resolve));
    const tab = new Tab(ws);
    await tab.call("Runtime.enable");
    await tab.call("Page.enable");
    const { dark, ...metrics } = view;
    await tab.call("Emulation.setDeviceMetricsOverride", { deviceScaleFactor: 2, ...metrics });
    if (dark !== undefined) {
      await tab.call("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }],
      });
    }
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

  text = () => this.eval<string>('document.body?.innerText ?? ""');

  async waitFor(needle: string, timeoutMs = 6000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // A page mid-load or mid-reload has no context to evaluate in yet.
      if ((await this.text().catch(() => "")).includes(needle)) return;
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

  close(): void {
    this.ws.send(JSON.stringify({ id: ++this.id, method: "Page.close", params: {} }));
  }

  overflow = () => this.eval<boolean>("document.documentElement.scrollWidth > innerWidth");
}

export async function until(tab: Tab, expression: string, label: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await tab.eval<boolean>(expression))) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(100);
  }
}

export const frames = (selector: string) =>
  `(document.querySelector("${selector}")?.videoWidth ?? 0) > 0`;
