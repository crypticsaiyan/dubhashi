/**
 * Camera frames as JPEG through the server, for when WebRTC finds no direct
 * path between the phones (carrier NAT on mobile data). Lower frame rate and
 * quality than WebRTC, but works wherever the call itself works.
 */
export class FrameRelay {
  private ws: WebSocket | null = null;
  private source: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly canvas = document.createElement("canvas");
  private frame: string | null = null;
  private encoding = false;

  constructor(private readonly onFrame: (url: string | null) => void) {}

  /** Opens the relay socket for this call. Called again after each reconnect. */
  connect(url: string): void {
    this.ws?.close();
    const ws = new WebSocket(url);
    ws.binaryType = "blob";
    ws.onmessage = ({ data }) => {
      if (!(data instanceof Blob)) return;
      const previous = this.frame;
      this.frame = URL.createObjectURL(data);
      this.onFrame(this.frame);
      if (previous) URL.revokeObjectURL(previous);
    };
    this.ws = ws;
  }

  /** Sends frames from the camera, about 10 a second, while shouldSend() holds. */
  start(stream: MediaStream, shouldSend: () => boolean): void {
    this.stop();
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.play().catch(() => {});
    this.source = video;
    this.timer = setInterval(() => this.capture(shouldSend), 100);
  }

  private capture(shouldSend: () => boolean): void {
    const { ws, source } = this;
    if (!ws || ws.readyState !== WebSocket.OPEN || !source?.videoWidth || this.encoding) return;
    // Skip frames rather than queue them on a slow network.
    if (ws.bufferedAmount > 64 * 1024 || !shouldSend()) return;
    const width = 320;
    const height = Math.round((width * source.videoHeight) / source.videoWidth);
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.getContext("2d")?.drawImage(source, 0, 0, width, height);
    this.encoding = true;
    this.canvas.toBlob(
      (blob) => {
        this.encoding = false;
        if (blob && ws.readyState === WebSocket.OPEN) ws.send(blob);
      },
      "image/jpeg",
      0.6,
    );
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.source) this.source.srcObject = null;
    this.source = null;
  }

  clearFrame(): void {
    if (this.frame) URL.revokeObjectURL(this.frame);
    this.frame = null;
    this.onFrame(null);
  }

  close(): void {
    this.stop();
    this.ws?.close();
    this.ws = null;
    this.clearFrame();
  }
}
