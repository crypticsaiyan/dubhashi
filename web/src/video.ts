import type { IceServer, Signal } from "../../shared/protocol";

export interface VideoState {
  local: MediaStream | null;
  /** Set only while the other person has their camera on. */
  remote: MediaStream | null;
}

/**
 * Peer-to-peer video beside the interpreted voice. Carries no audio: each
 * person hears the other only through the translator, never raw.
 *
 * Uses the "perfect negotiation" pattern so either side can switch its camera
 * on at any time without the two offers colliding.
 */
export class VideoLink {
  private pc: RTCPeerConnection | null = null;
  private camera: MediaStream | null = null;
  private remote: MediaStream | null = null;
  private peerCamera = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private iceServers: IceServer[] = [];
  private polite = false;

  constructor(
    private readonly send: (signal: Signal) => void,
    private readonly onChange: (state: VideoState) => void,
  ) {}

  /** The person who joined is polite: their offer yields if both offer at once. */
  configure(iceServers: IceServer[], polite: boolean): void {
    this.iceServers = iceServers;
    this.polite = polite;
  }

  get cameraOn(): boolean {
    return this.camera !== null;
  }

  async startCamera(): Promise<void> {
    if (this.camera) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
    });
    this.camera = stream;
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("No camera track");
    const pc = this.connection();
    const transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === "video");
    if (transceiver) {
      // Reuse the one video slot, made by either side. Changing its direction
      // renegotiates; swapping the track alone does not.
      await transceiver.sender.replaceTrack(track);
      transceiver.sender.setStreams?.(stream);
      if (transceiver.direction !== "sendrecv") transceiver.direction = "sendrecv";
    } else {
      pc.addTrack(track, stream);
    }
    this.send({ kind: "camera", on: true });
    this.emit();
  }

  stopCamera(): void {
    if (!this.camera) return;
    this.camera.getTracks().forEach((t) => t.stop());
    this.camera = null;
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    void sender?.replaceTrack(null);
    this.send({ kind: "camera", on: false });
    this.emit();
  }

  async handle(signal: Signal): Promise<void> {
    if (signal.kind === "hello") return this.reset();
    if (signal.kind === "camera") {
      this.peerCamera = signal.on;
      return this.emit();
    }
    const pc = this.connection();
    try {
      if (signal.kind === "description") {
        const { description } = signal;
        const collision =
          description.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          await pc.setLocalDescription();
          this.sendDescription(pc);
        }
      } else {
        await pc.addIceCandidate(signal.candidate).catch((error: unknown) => {
          if (!this.ignoreOffer) throw error;
        });
      }
    } catch (error) {
      console.error("[video]", error);
    }
  }

  /** Starts a new link, re-offering the camera if it is on. */
  private reset(): void {
    this.pc?.close();
    this.pc = null;
    this.remote = null;
    this.peerCamera = false;
    this.makingOffer = false;
    this.ignoreOffer = false;
    const track = this.camera?.getVideoTracks()[0];
    if (this.camera && track) {
      this.connection().addTrack(track, this.camera);
      this.send({ kind: "camera", on: true });
    }
    this.emit();
  }

  close(): void {
    this.camera?.getTracks().forEach((t) => t.stop());
    this.camera = null;
    this.pc?.close();
    this.pc = null;
    this.remote = null;
    this.peerCamera = false;
    this.emit();
  }

  private connection(): RTCPeerConnection {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.sendDescription(pc);
      } catch (error) {
        console.error("[video]", error);
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const { sdpMid, sdpMLineIndex, usernameFragment } = candidate;
      this.send({
        kind: "candidate",
        candidate: { candidate: candidate.candidate, sdpMid, sdpMLineIndex, usernameFragment },
      });
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") pc.restartIce();
    };
    pc.ontrack = ({ track, streams }) => {
      this.remote = streams[0] ?? new MediaStream([track]);
      this.emit();
    };
    return pc;
  }

  private sendDescription(pc: RTCPeerConnection): void {
    const description = pc.localDescription;
    if (description?.type !== "offer" && description?.type !== "answer") return;
    this.send({ kind: "description", description: { type: description.type, sdp: description.sdp } });
  }

  private emit(): void {
    this.onChange({ local: this.camera, remote: this.peerCamera ? this.remote : null });
  }
}
