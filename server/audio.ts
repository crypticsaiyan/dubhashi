/** Prisma streaming requires binary frames of exactly this many bytes. */
export const STT_FRAME_BYTES = 1024;

/** Cuts an arbitrary byte stream into fixed-size frames. */
export class FrameBuffer {
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly frameBytes = STT_FRAME_BYTES) {}

  push(data: Buffer): Buffer[] {
    this.pending = this.pending.length ? Buffer.concat([this.pending, data]) : data;
    const frames: Buffer[] = [];
    let offset = 0;
    while (this.pending.length - offset >= this.frameBytes) {
      frames.push(this.pending.subarray(offset, offset + this.frameBytes));
      offset += this.frameBytes;
    }
    this.pending = this.pending.subarray(offset);
    return frames;
  }

  /** Returns the remainder padded with silence, or null when nothing is left. */
  flush(): Buffer | null {
    if (this.pending.length === 0) return null;
    const frame = Buffer.alloc(this.frameBytes);
    this.pending.copy(frame);
    this.pending = Buffer.alloc(0);
    return frame;
  }
}

/** Keeps 16-bit samples whole when upstream chunks split on an odd byte. */
export class SampleAligner {
  private carry: Buffer | null = null;

  push(data: Buffer): Buffer {
    const joined = this.carry ? Buffer.concat([this.carry, data]) : data;
    const even = joined.length - (joined.length % 2);
    this.carry = even < joined.length ? joined.subarray(even) : null;
    return joined.subarray(0, even);
  }
}

export interface SseEvent {
  event: string;
  data: string;
}

/** Incremental Server-Sent Events parser. */
export class SseParser {
  private buffer = "";

  push(text: string): SseEvent[] {
    this.buffer += text.replace(/\r\n/g, "\n");
    const events: SseEvent[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const parsed = parseBlock(block);
      if (parsed) events.push(parsed);
      boundary = this.buffer.indexOf("\n\n");
    }
    return events;
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

/** Wraps PCM in a WAV header. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
