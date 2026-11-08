import { describe, expect, it, vi } from "vitest";
import { FrameBuffer, SampleAligner, SseParser, pcmToWav } from "../server/audio";
import { RateLimitError, SerialQueue, WindowLimiter } from "../server/limiter";
import { parseClientMessage } from "../server/messages";
import { parseTranslation, registerInstruction } from "../server/providers/llm";
import { extractNumbers, missingNumbers, normalizeDigits, splitForTts } from "../server/text";
import { initialState, reduce } from "../web/src/state";

describe("FrameBuffer", () => {
  it("emits exact frames and keeps the remainder", () => {
    const buffer = new FrameBuffer(4);
    const frames = buffer.push(Buffer.from([1, 2, 3, 4, 5, 6]));
    expect(frames).toEqual([Buffer.from([1, 2, 3, 4])]);
    expect(buffer.push(Buffer.from([7, 8]))).toEqual([Buffer.from([5, 6, 7, 8])]);
  });

  it("pads the final frame with silence", () => {
    const buffer = new FrameBuffer(4);
    buffer.push(Buffer.from([9]));
    expect(buffer.flush()).toEqual(Buffer.from([9, 0, 0, 0]));
    expect(buffer.flush()).toBeNull();
  });
});

describe("SampleAligner", () => {
  it("never splits a 16-bit sample", () => {
    const aligner = new SampleAligner();
    expect(aligner.push(Buffer.from([1, 2, 3]))).toEqual(Buffer.from([1, 2]));
    expect(aligner.push(Buffer.from([4, 5]))).toEqual(Buffer.from([3, 4]));
    expect(aligner.push(Buffer.from([6]))).toEqual(Buffer.from([5, 6]));
  });
});

describe("SseParser", () => {
  it("parses events split across chunks and CRLF", () => {
    const parser = new SseParser();
    expect(parser.push('event: chunk\r\ndata: {"a"')).toEqual([]);
    expect(parser.push(':1}\r\n\r\nevent: complete\ndata: {}\n\n')).toEqual([
      { event: "chunk", data: '{"a":1}' },
      { event: "complete", data: "{}" },
    ]);
  });
});

describe("pcmToWav", () => {
  it("writes a valid header", () => {
    const wav = pcmToWav(Buffer.alloc(100), 16000);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(40)).toBe(100);
    expect(wav.length).toBe(144);
  });
});

describe("number guard", () => {
  it("normalizes Indic digits", () => {
    expect(normalizeDigits("৫০০ மி ५ ೩ ൭")).toBe("500 மி 5 3 7");
  });

  it("removes grouping commas and sentence dots", () => {
    expect(extractNumbers("Pay ₹1,500. Take 2.5 ml.")).toEqual(["1500", "2.5"]);
  });

  it("matches the same number across scripts", () => {
    expect(missingNumbers("500 mg", "৫০০ মিগ্রা")).toEqual([]);
  });

  it("flags a dropped or changed number", () => {
    expect(missingNumbers("take 500 mg twice, 3 days", "take 50 mg, 3 days")).toEqual(["500"]);
  });

  it("counts repeated numbers", () => {
    expect(missingNumbers("2 and 2", "2")).toEqual(["2"]);
  });
});

describe("splitForTts", () => {
  it("keeps short text whole", () => {
    expect(splitForTts("नमस्ते। आप कैसे हैं?")).toEqual(["नमस्ते। आप कैसे हैं?"]);
  });

  it("splits long text at sentence ends", () => {
    const sentence = "यह एक वाक्य है। ";
    const parts = splitForTts(sentence.repeat(20), 60);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 60)).toBe(true);
    expect(parts.join(" ")).toBe(sentence.repeat(20).trim());
  });
});

describe("SerialQueue", () => {
  it("never runs two tasks at once", async () => {
    const queue = new SerialQueue({ minGapMs: 0, maxRetries: 0, retryBaseMs: 1 });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    };
    await Promise.all([queue.run(task), queue.run(task), queue.run(task)]);
    expect(peak).toBe(1);
  });

  it("retries rate limits and then succeeds", async () => {
    const queue = new SerialQueue({ minGapMs: 0, maxRetries: 2, retryBaseMs: 1 });
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new RateLimitError())
      .mockResolvedValue("ok");
    await expect(queue.run(task)).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors, and keeps working after one", async () => {
    const queue = new SerialQueue({ minGapMs: 0, maxRetries: 2, retryBaseMs: 1 });
    const task = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("boom"));
    await expect(queue.run(task)).rejects.toThrow("boom");
    expect(task).toHaveBeenCalledTimes(1);
    await expect(queue.run(async () => "next")).resolves.toBe("next");
  });
});

describe("WindowLimiter", () => {
  it("blocks past the limit and resets", () => {
    const limiter = new WindowLimiter(2, 1000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 1)).toBe(true);
    expect(limiter.allow("a", 2)).toBe(false);
    expect(limiter.allow("b", 2)).toBe(true);
    expect(limiter.allow("a", 1001)).toBe(true);
  });
});

describe("parseClientMessage", () => {
  const profile = { name: " Asha ", language: "bn-IN", gender: "female" };

  it("accepts and normalizes a join", () => {
    expect(parseClientMessage(JSON.stringify({ type: "join", code: " ab2 ", ...profile }))).toEqual({
      type: "join",
      code: "AB2",
      name: "Asha",
      language: "bn-IN",
      gender: "female",
      voiceId: undefined,
    });
  });

  it.each([
    ["bad json", "{"],
    ["null", "null"],
    ["unknown type", '{"type":"nope"}'],
    ["bad language", JSON.stringify({ type: "create", relationship: "doctor", ...profile, language: "fr" })],
    ["bad relationship", JSON.stringify({ type: "create", relationship: "boss", ...profile })],
    ["blank name", JSON.stringify({ type: "create", relationship: "doctor", ...profile, name: "  " })],
    ["bad confirm", JSON.stringify({ type: "confirm", turnId: "1", ok: true })],
    ["empty typed turn", JSON.stringify({ type: "text_turn", text: "   " })],
    ["long typed turn", JSON.stringify({ type: "text_turn", text: "a".repeat(501) })],
    ["unknown signal", JSON.stringify({ type: "signal", signal: { kind: "media", data: 1 } })],
    [
      "rollback description",
      JSON.stringify({ type: "signal", signal: { kind: "description", description: { type: "rollback", sdp: "" } } }),
    ],
    [
      "huge sdp",
      JSON.stringify({
        type: "signal",
        signal: { kind: "description", description: { type: "offer", sdp: "x".repeat(20_000) } },
      }),
    ],
    [
      "bad candidate",
      JSON.stringify({ type: "signal", signal: { kind: "candidate", candidate: { candidate: "c", sdpMLineIndex: "0" } } }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("keeps only known signal fields", () => {
    const raw = JSON.stringify({
      type: "signal",
      signal: { kind: "candidate", candidate: { candidate: "c", sdpMid: "0", sdpMLineIndex: 0, extra: "x" } },
    });
    expect(parseClientMessage(raw)).toEqual({
      type: "signal",
      signal: {
        kind: "candidate",
        candidate: { candidate: "c", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: undefined },
      },
    });
  });
});

describe("translation parsing", () => {
  it("tolerates code fences and fills spoken", () => {
    const parsed = parseTranslation('```json\n{"translation":"நன்றி","spoken":"","facts":["500?",3]}\n```');
    expect(parsed).toEqual({ translation: "நன்றி", spoken: "நன்றி", facts: ["500?"] });
  });

  it("rejects an empty translation", () => {
    expect(() => parseTranslation('{"translation":" "}')).toThrow();
  });

  it("sets register by direction", () => {
    expect(registerInstruction("elder", true)).toContain("most respectful");
    expect(registerInstruction("elder", false)).toContain("familiar");
  });
});

describe("client reducer", () => {
  it("attaches they_heard to the speaker's entry only", () => {
    let state = reduce(initialState, { type: "peer_turn", turnId: 1, text: "peer" });
    state = reduce(state, { type: "my_turn", turnId: 1, text: "mine" });
    state = reduce(state, { type: "they_heard", turnId: 1, text: "back" });
    expect(state.entries.find((e) => e.mine)?.theyHeard).toBe("back");
    expect(state.entries.find((e) => !e.mine)?.theyHeard).toBeUndefined();
  });

  it("removes a cancelled turn and its confirm card", () => {
    let state = reduce(initialState, { type: "my_turn", turnId: 2, text: "x" });
    state = reduce(state, { type: "confirm_needed", turnId: 2, items: ["5?"], mismatch: false });
    state = reduce(state, { type: "turn_cancelled", turnId: 2 });
    expect(state.entries).toEqual([]);
    expect(state.confirm).toBeNull();
  });
});
