import { MIC_SAMPLE_RATE, PLAYBACK_SAMPLE_RATE } from "../../shared/protocol";

/** Blocks kept before a press, so the first syllable is not cut off. */
const PRE_ROLL_BLOCKS = 6;

export class Mic {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private recent: ArrayBuffer[] = [];
  private sink: ((block: ArrayBuffer) => void) | null = null;
  /** Smoothed loudness of the latest block, 0 to 1, for meters. */
  level = 0;

  async start(): Promise<void> {
    if (this.context) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.context = new AudioContext();
    await this.context.resume();
    await this.context.audioWorklet.addModule("/mic-worklet.js");
    const source = this.context.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.context, "mic-processor");
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      this.level = this.level * 0.6 + loudness(event.data) * 0.4;
      if (this.sink) this.sink(event.data);
      else {
        this.recent.push(event.data);
        if (this.recent.length > PRE_ROLL_BLOCKS) this.recent.shift();
      }
    };
    source.connect(node);
  }

  /** Streams to the sink, starting with the pre-roll. */
  capture(sink: (block: ArrayBuffer) => void): void {
    for (const block of this.recent) sink(block);
    this.recent = [];
    this.sink = sink;
  }

  release(): void {
    this.sink = null;
  }

  stop(): void {
    this.release();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.context = null;
    this.stream = null;
  }
}

/** RMS of an Int16 block, scaled so normal speech reaches about 1. */
function loudness(block: ArrayBuffer): number {
  const samples = new Int16Array(block);
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / Math.max(samples.length, 1)) / 0x8000;
  return Math.min(1, rms * 6);
}

/** Plays streamed PCM gaplessly. */
export class PcmPlayer {
  private context: AudioContext | null = null;
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();

  /** Must run inside a user gesture, or mobile browsers keep audio muted. */
  unlock(): void {
    this.context ??= new AudioContext();
    void this.context.resume();
  }

  push(data: ArrayBuffer): void {
    const context = this.context;
    if (!context) return;
    const samples = new Int16Array(data);
    if (samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, PLAYBACK_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = (samples[i] ?? 0) / 0x8000;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => this.sources.delete(source);
    this.nextStart = Math.max(this.nextStart, context.currentTime + 0.05);
    source.start(this.nextStart);
    this.nextStart += buffer.duration;
    this.sources.add(source);
  }

  /** Milliseconds of audio still queued. */
  remainingMs(): number {
    const context = this.context;
    return context ? Math.max(0, (this.nextStart - context.currentTime) * 1000) : 0;
  }

  stop(): void {
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.nextStart = 0;
  }
}

export function encodeWav(blocks: ArrayBuffer[]): Blob {
  const bytes = blocks.reduce((total, block) => total + block.byteLength, 0);
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, value: string) =>
    [...value].forEach((char, i) => header.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF");
  header.setUint32(4, 36 + bytes, true);
  text(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, MIC_SAMPLE_RATE, true);
  header.setUint32(28, MIC_SAMPLE_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, bytes, true);
  return new Blob([header.buffer, ...blocks], { type: "audio/wav" });
}
