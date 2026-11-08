import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { GnaniSttSession } from "../server/providers/gnani";

const TIMING = { frameIntervalMs: 1, settleMs: 10, silenceMs: 30, finishTimeoutMs: 500 };

/** Stands in for Prisma, recording what the client sends. */
async function fakePrisma(onCommit: (ws: WebSocket) => void) {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const frames: number[] = [];
  const seen: { headers?: Record<string, unknown>; committed: boolean } = { committed: false };
  server.on("connection", (ws, request) => {
    seen.headers = request.headers;
    ws.on("message", (data, isBinary) => {
      if (isBinary) frames.push((data as Buffer).length);
      else if (JSON.parse(data.toString()).type === "commit") {
        seen.committed = true;
        onCommit(ws);
      }
    });
  });
  return { server, frames, seen, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const say = (ws: WebSocket, message: object) => ws.send(JSON.stringify(message));

describe("GnaniSttSession", () => {
  let close: (() => void) | null = null;
  afterEach(() => close?.());

  it("sends exact 1024-byte frames, commits, and returns the transcript", async () => {
    const prisma = await fakePrisma((ws) => {
      say(ws, { type: "processing" });
      setTimeout(() => say(ws, { type: "transcript", text: "நன்றி" }), 5);
    });
    close = () => prisma.server.close();

    const session = new GnaniSttSession(prisma.url, { language_code: "ta-IN" }, () => undefined, TIMING);
    session.write(Buffer.alloc(1500));
    session.write(Buffer.alloc(1000));

    await expect(session.finish()).resolves.toBe("நன்றி");
    expect(prisma.frames).toEqual([1024, 1024, 1024]);
    expect(prisma.seen.committed).toBe(true);
    expect(prisma.seen.headers?.language_code).toBe("ta-IN");
  });

  it("joins segments split by a pause during one press", async () => {
    let socket: WebSocket | undefined;
    const prisma = await fakePrisma((ws) => {
      say(ws, { type: "processing" });
      say(ws, { type: "transcript", text: "second" });
    });
    close = () => prisma.server.close();
    prisma.server.on("connection", (ws) => {
      socket = ws;
      say(ws, { type: "speech_start" });
      say(ws, { type: "processing" });
      say(ws, { type: "transcript", text: "first" });
      say(ws, { type: "speech_start" });
    });

    const session = new GnaniSttSession(prisma.url, {}, () => undefined, TIMING);
    session.write(Buffer.alloc(1024));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(session.finish()).resolves.toBe("first second");
    expect(socket).toBeDefined();
  });

  it("waits for an open segment even after settle time passes", async () => {
    const prisma = await fakePrisma((ws) => {
      say(ws, { type: "speech_start" });
      setTimeout(() => say(ws, { type: "transcript", text: "late" }), 80);
    });
    close = () => prisma.server.close();
    const session = new GnaniSttSession(prisma.url, {}, () => undefined, TIMING);
    session.write(Buffer.alloc(1024));
    await expect(session.finish()).resolves.toBe("late");
  });

  it("resolves empty when nothing was heard", async () => {
    const prisma = await fakePrisma(() => undefined);
    close = () => prisma.server.close();
    const session = new GnaniSttSession(prisma.url, {}, () => undefined, TIMING);
    await expect(session.finish()).resolves.toBe("");
  });

  it("rejects when the upstream reports an error", async () => {
    const prisma = await fakePrisma((ws) => say(ws, { type: "error", message: "engine down" }));
    close = () => prisma.server.close();
    const session = new GnaniSttSession(prisma.url, {}, () => undefined, TIMING);
    await expect(session.finish()).rejects.toThrow("engine down");
  });

  it("buffers audio written before the socket opens", async () => {
    const prisma = await fakePrisma((ws) => say(ws, { type: "transcript", text: "ok" }));
    close = () => prisma.server.close();
    const session = new GnaniSttSession(prisma.url, {}, () => undefined, TIMING);
    session.write(Buffer.alloc(2048));
    await session.finish();
    expect(prisma.frames).toEqual([1024, 1024]);
  });
});
