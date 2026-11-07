// Downsamples the mic to 16 kHz by averaging, then posts 512-sample Int16 blocks.
const TARGET_RATE = 16000;
const BLOCK = 512;

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.position = 0;
    this.sum = 0;
    this.count = 0;
    this.block = new Int16Array(BLOCK);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i];
      this.count += 1;
      this.position += 1;
      if (this.position >= this.ratio) {
        this.position -= this.ratio;
        const sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.block[this.filled++] = sample * 0x7fff;
        if (this.filled === BLOCK) {
          const out = this.block;
          this.port.postMessage(out.buffer, [out.buffer]);
          this.block = new Int16Array(BLOCK);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);
