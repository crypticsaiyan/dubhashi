import { randomInt, randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { ClientMessage, Profile, Relationship, ServerMessage } from "../shared/protocol";
import type { Config } from "./config";
import { WindowLimiter } from "./limiter";
import { parseClientMessage } from "./messages";
import type { SpeakerEmbedding, Speech, Translator } from "./providers/types";
import { DEFAULT_ROOM_OPTIONS, Room } from "./room";
import type { Connection, Member, RoomOptions } from "./room";

const MAX_VOICE_BYTES = 2 * 1024 * 1024;
const VOICE_TTL_MS = 60 * 60 * 1000;
const ROOM_IDLE_MS = 30 * 60 * 1000;
/** No 0, O, 1 or I, so codes survive being read aloud over a phone. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

export interface AppDeps {
  config: Pick<Config, "mock" | "allowedOrigins"> & Partial<Pick<Config, "iceServers">>;
  speech: Speech;
  translator: Translator;
  staticDir?: string;
  roomOptions?: Partial<RoomOptions>;
  /** Per-IP limits per hour. Raised only by test harnesses. */
  limits?: { rooms: number; voices: number };
}

interface StoredVoice {
  embedding: SpeakerEmbedding;
  expiresAt: number;
}

export function createApp(deps: AppDeps): { server: Server; rooms: Map<string, Room>; close: () => void } {
  const { config, speech, translator } = deps;
  const rooms = new Map<string, Room>();
  const voices = new Map<string, StoredVoice>();
  const roomLimiter = new WindowLimiter(deps.limits?.rooms ?? 30, 60 * 60 * 1000);
  const voiceLimiter = new WindowLimiter(deps.limits?.voices ?? 10, 60 * 60 * 1000);
  const roomOptions: RoomOptions = {
    ...DEFAULT_ROOM_OPTIONS,
    mock: config.mock,
    ...(config.iceServers ? { iceServers: config.iceServers } : {}),
    ...deps.roomOptions,
  };

  const originAllowed = (origin: string | undefined) =>
    config.allowedOrigins.length === 0 || (origin !== undefined && config.allowedOrigins.includes(origin));

  const clientIp = (request: IncomingMessage) => request.socket.remoteAddress ?? "unknown";

  function newCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function takeEmbedding(profile: Profile): SpeakerEmbedding | undefined {
    if (!profile.voiceId) return undefined;
    const stored = voices.get(profile.voiceId);
    return stored && stored.expiresAt > Date.now() ? stored.embedding : undefined;
  }

  async function handleVoice(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.headers["x-voice-consent"] !== "yes") {
      request.resume();
      return reply(400, { error: "Consent is required to clone a voice." });
    }
    if (!voiceLimiter.allow(clientIp(request))) {
      request.resume();
      return reply(429, { error: "Too many voice uploads. Try later." });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_VOICE_BYTES) return reply(413, { error: "Recording too large." });
      chunks.push(chunk);
    }
    try {
      // Only the embedding is kept. The recording itself is never stored.
      const embedding = await speech.createVoice(Buffer.concat(chunks));
      const voiceId = randomUUID();
      voices.set(voiceId, { embedding, expiresAt: Date.now() + VOICE_TTL_MS });
      reply(200, { voiceId });
    } catch (error) {
      console.error("[voice]", String(error));
      reply(502, { error: "Could not create voice." });
    }
  }

  function serveStatic(pathname: string, response: ServerResponse): void {
    const root = deps.staticDir ? resolve(deps.staticDir) : null;
    if (!root) {
      response.writeHead(404).end("Not found");
      return;
    }
    const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
    let file = join(root, relative);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    if (!existsSync(file)) {
      response.writeHead(404).end("Build the client first: pnpm build");
      return;
    }
    response.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  }

  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, mock: config.mock, rooms: rooms.size }));
    } else if (pathname === "/api/voice" && request.method === "POST") {
      void handleVoice(request, response);
    } else if (request.method === "GET") {
      try {
        serveStatic(pathname, response);
      } catch {
        response.writeHead(400).end("Bad request");
      }
    } else {
      response.writeHead(405).end("Method not allowed");
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname !== "/ws" || !originAllowed(request.headers.origin)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => attach(ws, request));
  });

  function attach(ws: WebSocket, request: IncomingMessage): void {
    let room: Room | null = null;
    let member: Member | null = null;

    const connection: Connection = {
      send: (message: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
      sendAudio: (pcm) => {
        if (ws.readyState === ws.OPEN) ws.send(pcm, { binary: true });
      },
    };
    const fail = (message: string) => connection.send({ type: "error", message });

    function enter(message: Extract<ClientMessage, { type: "create" | "join" }>): void {
      if (member) return;
      const profile = {
        name: message.name,
        language: message.language,
        gender: message.gender,
        embedding: takeEmbedding(message),
      };
      if (message.type === "create") {
        if (!roomLimiter.allow(clientIp(request))) return fail("Too many calls started. Try later.");
        const created = createRoom(message.relationship);
        room = created;
        member = created.addMember(profile, connection);
        return;
      }
      const target = rooms.get(message.code);
      if (!target) return fail("No call found with that code.");
      const added = target.addMember(profile, connection);
      if (!added) return fail("This call is already full.");
      room = target;
      member = added;
    }

    function handle(message: ClientMessage): void {
      if (message.type === "create" || message.type === "join") return enter(message);
      if (message.type === "resume") {
        const target = rooms.get(message.code);
        const resumed = target?.resume(message.token, connection) ?? null;
        if (!target || !resumed) return fail("This call has ended.");
        room = target;
        member = resumed;
        return;
      }
      if (!room || !member) return;
      switch (message.type) {
        case "talk_start":
          return room.talkStart(member);
        case "talk_end":
          return void room.talkEnd(member);
        case "text_turn":
          return void room.textTurn(member, message.text);
        case "confirm":
          return void room.confirm(member, message.turnId, message.ok);
        case "playback_done":
          return room.playbackDone(member, message.turnId);
        case "end_call":
          return void room.end();
        case "summary_audio":
          return void room.speakSummary(member);
        case "signal":
          return room.relaySignal(member, message.signal);
      }
    }

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (room && member) room.audio(member, data as Buffer);
        return;
      }
      const message = parseClientMessage(data.toString());
      if (message) handle(message);
      else fail("Malformed message.");
    });
    ws.on("close", () => {
      if (room && member) room.disconnect(member, connection);
    });
    ws.on("error", (error) => console.error("[ws]", error.message));
  }

  function createRoom(relationship: Relationship): Room {
    const room = new Room(newCode(), relationship, speech, translator, roomOptions);
    rooms.set(room.code, room);
    return room;
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (now - room.lastActivity > ROOM_IDLE_MS) {
        room.dispose();
        rooms.delete(code);
      }
    }
    for (const [id, voice] of voices) if (voice.expiresAt <= now) voices.delete(id);
  }, 60_000);
  sweep.unref();

  return {
    server,
    rooms,
    close: () => {
      clearInterval(sweep);
      for (const client of wss.clients) client.terminate();
      for (const room of rooms.values()) room.dispose();
      server.close();
    },
  };
}
