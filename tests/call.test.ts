import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import { createApp } from "../server/app";
import { MockSpeech, MockTranslator } from "../server/providers/mock";

type Message<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

/** A scripted browser connected over a real WebSocket. */
class Client {
  readonly messages: ServerMessage[] = [];
  readonly audio: Buffer[] = [];
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on("message", (data, isBinary) => {
      if (isBinary) this.audio.push(data as Buffer);
      else this.messages.push(JSON.parse(data.toString()) as ServerMessage);
      this.waiters.splice(0).forEach((wake) => wake());
    });
  }

  send(message: ClientMessage) {
    this.ws.send(JSON.stringify(message));
  }

  async next<T extends ServerMessage["type"]>(
    type: T,
    match: (message: Message<T>) => boolean = () => true,
  ): Promise<Message<T>> {
    const deadline = Date.now() + 2000;
    for (;;) {
      const found = this.messages.find(
        (message): message is Message<T> => message.type === type && match(message as Message<T>),
      );
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(`Timed out on ${type}. Saw: ${this.messages.map((m) => m.type).join(",")}`);
      }
      await Promise.race([
        new Promise<void>((resolve) => this.waiters.push(resolve)),
        new Promise((resolve) => setTimeout(resolve, 50)),
      ]);
    }
  }

  phase(phase: string) {
    return this.next("room", (message) => message.phase === phase);
  }

  clear() {
    this.messages.length = 0;
  }
}

describe("two-person call", () => {
  let speech: MockSpeech;
  let translator: MockTranslator;
  let app: ReturnType<typeof createApp>;
  let url: string;

  beforeEach(async () => {
    speech = new MockSpeech();
    translator = new MockTranslator();
    app = createApp({
      config: { mock: true, allowedOrigins: [] },
      speech,
      translator,
      roomOptions: { playbackGraceMs: 100 },
    });
    app.server.listen(0);
    await once(app.server, "listening");
    url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
  });

  afterEach(() => app.close());

  async function connect(): Promise<Client> {
    const ws = new WebSocket(url);
    const client = new Client(ws);
    await once(ws, "open");
    return client;
  }

  async function startCall(relationship: "doctor" | "friend" = "doctor") {
    const patient = await connect();
    patient.send({ type: "create", relationship, name: "Asha", language: "bn-IN", gender: "female" });
    const { code } = await patient.next("joined");
    const doctor = await connect();
    doctor.send({ type: "join", code, name: "Dr Nair", language: "ml-IN", gender: "male" });
    await doctor.next("joined");
    await patient.phase("idle");
    await doctor.phase("idle");
    return { patient, doctor, code };
  }

  async function speak(client: Client, transcript: string) {
    speech.nextTranscript = transcript;
    client.send({ type: "talk_start" });
    await client.phase("speaking");
    client.ws.send(Buffer.alloc(2048));
    client.send({ type: "talk_end" });
  }

  it("carries a turn from speech to the listener's audio", async () => {
    const { patient, doctor } = await startCall("friend");
    await speak(patient, "stomach pain");

    expect((await patient.next("my_turn")).text).toBe("stomach pain");
    const heard = await doctor.next("peer_turn");
    expect(heard.text).toBe("[Malayalam] stomach pain");
    await doctor.next("audio_end");
    expect(doctor.audio.length).toBeGreaterThan(0);
    expect(patient.audio.length).toBe(0);

    const check = await patient.next("they_heard");
    expect(check.text).toBe("[back to Bengali] [Malayalam] stomach pain");
    const { metrics } = await patient.next("metrics");
    expect(metrics.totalMs).toBeGreaterThanOrEqual(0);

    doctor.send({ type: "playback_done", turnId: heard.turnId });
    await doctor.phase("idle");
  });

  it("translates a typed turn like a spoken one, without recognition", async () => {
    const { patient, doctor } = await startCall("friend");
    patient.send({ type: "text_turn", text: "  my head hurts  " });
    expect((await patient.next("my_turn")).text).toBe("my head hurts");
    expect((await doctor.next("peer_turn")).text).toBe("[Malayalam] my head hurts");
    const { metrics } = await patient.next("metrics");
    expect(metrics.sttMs).toBe(0);
  });

  it("refuses a typed turn while someone is speaking", async () => {
    const { patient, doctor } = await startCall("friend");
    patient.send({ type: "talk_start" });
    await doctor.phase("speaking");
    doctor.send({ type: "text_turn", text: "hello" });
    expect((await doctor.next("notice")).code).toBe("busy");
  });

  it("relays video signalling to the other person only", async () => {
    const { patient, doctor } = await startCall();
    expect((await patient.next("joined")).iceServers.length).toBeGreaterThan(0);
    const offer = { kind: "description", description: { type: "offer", sdp: "v=0" } } as const;
    patient.send({ type: "signal", signal: offer });
    expect((await doctor.next("signal")).signal).toEqual(offer);
    doctor.send({ type: "signal", signal: { kind: "camera", on: true } });
    expect((await patient.next("signal")).signal).toEqual({ kind: "camera", on: true });
    expect(patient.messages.filter((m) => m.type === "signal")).toHaveLength(1);
  });

  it("gives the translator direction, relationship and memory", async () => {
    const { patient, doctor } = await startCall("friend");
    await speak(patient, "first");
    const first = await doctor.next("peer_turn");
    doctor.send({ type: "playback_done", turnId: first.turnId });
    doctor.clear();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await speak(doctor, "second");
    await patient.next("peer_turn");

    const [one, two] = translator.requests;
    expect(one).toMatchObject({ from: "bn-IN", to: "ml-IN", speakerIsCaller: true, relationship: "friend" });
    expect(two).toMatchObject({ from: "ml-IN", to: "bn-IN", speakerIsCaller: false });
    expect(two?.history[0]?.text).toContain("first");
  });

  it("holds a dose for confirmation on a strict call", async () => {
    const { patient, doctor } = await startCall("doctor");
    await speak(doctor, "take 500 mg");

    const check = await doctor.next("confirm_needed");
    expect(check.items).toEqual(["500?"]);
    expect(check.mismatch).toBe(false);
    expect(patient.messages.some((m) => m.type === "peer_turn")).toBe(false);

    doctor.send({ type: "confirm", turnId: check.turnId, ok: true });
    expect((await patient.next("peer_turn")).text).toContain("500");
  });

  it("drops the turn when the speaker says no", async () => {
    const { patient, doctor } = await startCall("doctor");
    await speak(doctor, "take 500 mg");
    const check = await doctor.next("confirm_needed");

    doctor.send({ type: "confirm", turnId: check.turnId, ok: false });
    await doctor.next("turn_cancelled");
    await doctor.phase("idle");
    expect(patient.messages.some((m) => m.type === "peer_turn")).toBe(false);
    expect(speech.synthesized).toEqual([]);
  });

  it("stops a changed number even on a relaxed call", async () => {
    const { patient } = await startCall("friend");
    translator.nextTranslation = "take 50 mg";
    await speak(patient, "take 500 mg");
    const check = await patient.next("confirm_needed");
    expect(check.mismatch).toBe(true);
  });

  it("lets only one person talk at a time", async () => {
    const { patient, doctor } = await startCall("friend");
    patient.send({ type: "talk_start" });
    await doctor.phase("speaking");
    doctor.send({ type: "talk_start" });
    const notice = await doctor.next("notice");
    expect(notice.code).toBe("busy");
  });

  it("ignores audio from the person not holding the turn", async () => {
    const { patient, doctor } = await startCall("friend");
    doctor.ws.send(Buffer.alloc(1024));
    await speak(patient, "");
    const notice = await patient.next("notice");
    expect(notice.code).toBe("not_heard");
    await patient.phase("idle");
    expect(translator.requests).toEqual([]);
  });

  it("frees the talk button if playback_done never arrives", async () => {
    const { patient, doctor } = await startCall("friend");
    await speak(patient, "hello");
    await doctor.next("audio_end");
    doctor.clear();
    await doctor.phase("idle");
  });

  it("still delivers text when synthesis fails", async () => {
    const { patient, doctor } = await startCall("friend");
    speech.failNextSynthesis = true;
    await speak(patient, "hello");
    await doctor.next("peer_turn");
    expect((await doctor.next("notice")).code).toBe("voice_failed");
    expect((await patient.next("notice")).code).toBe("voice_failed");
    await patient.phase("idle");
  });

  it("refuses a third person and an unknown code", async () => {
    const { code } = await startCall();
    const third = await connect();
    third.send({ type: "join", code, name: "X", language: "hi-IN", gender: "male" });
    expect((await third.next("error")).message).toContain("full");
    const lost = await connect();
    lost.send({ type: "join", code: "NOPE22", name: "X", language: "hi-IN", gender: "male" });
    expect((await lost.next("error")).message).toContain("No call");
  });

  it("cancels a turn on disconnect and resumes with the token", async () => {
    const { patient, doctor, code } = await startCall("friend");
    const { token } = await doctor.next("joined");
    patient.send({ type: "talk_start" });
    await doctor.phase("speaking");
    patient.clear();

    doctor.ws.close();
    await patient.next("room", (m) => m.peer?.online === false && m.phase === "idle");

    patient.send({ type: "talk_start" });
    expect((await patient.next("notice")).code).toBe("peer_offline");

    patient.clear();
    const back = await connect();
    back.send({ type: "resume", code, token });
    await back.next("joined");
    await patient.next("room", (m) => m.peer?.online === true);
  });

  it("rejects a resume with the wrong token", async () => {
    const { code } = await startCall();
    const intruder = await connect();
    intruder.send({ type: "resume", code, token: "guess" });
    expect((await intruder.next("error")).message).toContain("ended");
  });

  it("gives each person a summary in their language and can read it aloud", async () => {
    const { patient, doctor } = await startCall("friend");
    await speak(patient, "hello");
    const turn = await doctor.next("peer_turn");
    doctor.send({ type: "playback_done", turnId: turn.turnId });
    await doctor.phase("idle");

    doctor.send({ type: "end_call" });
    const mine = await patient.next("summary");
    const theirs = await doctor.next("summary");
    expect(mine.summary.keyPoints[0]).toContain("[Bengali]");
    expect(theirs.summary.keyPoints[0]).toContain("[Malayalam]");

    patient.send({ type: "summary_audio" });
    await patient.next("audio_end");
    expect(patient.audio.length).toBeGreaterThan(0);
  });

  it("uses the speaker's cloned voice only with consent", async () => {
    const base = url.replace("ws://", "http://").replace("/ws", "");
    const refused = await fetch(`${base}/api/voice`, { method: "POST", body: "x" });
    expect(refused.status).toBe(400);

    const created = await fetch(`${base}/api/voice`, {
      method: "POST",
      headers: { "X-Voice-Consent": "yes" },
      body: "wav",
    });
    const { voiceId } = (await created.json()) as { voiceId: string };

    const patient = await connect();
    patient.send({
      type: "create",
      relationship: "friend",
      name: "Asha",
      language: "bn-IN",
      gender: "female",
      voiceId,
    });
    const { code } = await patient.next("joined");
    const doctor = await connect();
    doctor.send({ type: "join", code, name: "Dr", language: "ml-IN", gender: "male" });
    await patient.phase("idle");

    await speak(patient, "hello");
    await doctor.next("audio_end");
    expect(speech.synthesized[0]).toMatchObject({ language: "ml-IN", cloned: true });
  });

  it("does not serve files outside the static root", async () => {
    const site = createApp({
      config: { mock: true, allowedOrigins: [] },
      speech,
      translator,
      staticDir: "web/public",
    });
    site.server.listen(0);
    await once(site.server, "listening");
    const { port } = site.server.address() as AddressInfo;

    // A raw request, because fetch would normalize the dots away.
    const get = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        request({ port, path }, (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
        })
          .on("error", reject)
          .end();
      });

    expect((await get("/mic-worklet.js")).body).toContain("registerProcessor");
    for (const path of ["/../../package.json", "/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json"]) {
      const { body } = await get(path);
      expect(body).not.toContain('"dubhashi"');
    }
    expect((await get("/%E0%A4%A")).status).toBe(400);
    site.close();
  });
});
