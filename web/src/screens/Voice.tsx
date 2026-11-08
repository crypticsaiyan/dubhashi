import { useEffect, useRef, useState } from "react";
import { MIC_SAMPLE_RATE } from "../../../shared/protocol";
import type { LanguageCode } from "../../../shared/protocol";
import { encodeWav } from "../audio";
import type { Mic } from "../audio";
import { STRINGS } from "../strings";

const TARGET_SECONDS = 15;
const MIN_SECONDS = 5;
const BARS = 12;
const RING = 2 * Math.PI * 54;

type Status = "ready" | "recording" | "uploading";

export function Voice({
  mic,
  language,
  onDone,
}: {
  mic: Mic;
  language: LanguageCode;
  onDone: (voiceId?: string) => void;
}) {
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>("ready");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const blocks = useRef<ArrayBuffer[]>([]);
  const meter = useRef<HTMLDivElement>(null);

  const upload = async () => {
    mic.release();
    const recorded = blocks.current;
    const bytes = recorded.reduce((total, block) => total + block.byteLength, 0);
    if (bytes / 2 / MIC_SAMPLE_RATE < MIN_SECONDS) {
      setStatus("ready");
      setError(`Please speak for at least ${MIN_SECONDS} seconds.`);
      return;
    }
    setStatus("uploading");
    try {
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "audio/wav", "X-Voice-Consent": "yes" },
        body: encodeWav(recorded),
      });
      const body = (await response.json()) as { voiceId?: string; error?: string };
      if (!response.ok || !body.voiceId) throw new Error(body.error ?? "Upload failed");
      onDone(body.voiceId);
    } catch (cause) {
      setStatus("ready");
      setError(cause instanceof Error ? cause.message : "Upload failed");
    }
  };

  const record = async () => {
    setError(null);
    try {
      await mic.start();
    } catch {
      setError("Microphone blocked. Allow microphone access and try again.");
      return;
    }
    blocks.current = [];
    setSeconds(0);
    setStatus("recording");
    mic.capture((block) => blocks.current.push(block));
  };

  useEffect(() => {
    if (status !== "recording") return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status === "recording" && seconds >= TARGET_SECONDS) void upload();
    // upload only reads refs and props that are stable for this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, status]);

  // Bars follow the mic so people can see they are being heard.
  useEffect(() => {
    if (status !== "recording") return;
    let frame = 0;
    const bars = [...(meter.current?.children ?? [])] as HTMLElement[];
    const history = new Array<number>(BARS).fill(0);
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 90) {
        last = now;
        history.shift();
        history.push(mic.level);
        bars.forEach((bar, i) => bar.style.setProperty("--h", (0.12 + (history[i] ?? 0) * 0.88).toFixed(2)));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [status, mic]);

  const progress = Math.min(seconds / TARGET_SECONDS, 1);

  return (
    <main className="page">
      <header className="brand plain">
        <div>
          <h1>Speak in your own voice</h1>
          <p>Read this aloud in a quiet place. They will hear this voice speak their language.</p>
        </div>
      </header>

      <blockquote className="prompt" lang={language}>
        {STRINGS[language].voicePrompt}
      </blockquote>

      <div className="recorder" aria-live="polite">
        <svg viewBox="0 0 120 120" className="ring" aria-hidden="true">
          <circle cx="60" cy="60" r="54" className="track" />
          <circle
            cx="60"
            cy="60"
            r="54"
            className="fill"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - progress)}
          />
        </svg>
        <div className="recorder-center">
          {status === "uploading" ? (
            <span className="spinner dark" />
          ) : (
            <>
              <strong>{seconds}s</strong>
              <span>of {TARGET_SECONDS}s</span>
            </>
          )}
        </div>
      </div>
      <div className={status === "recording" ? "level live" : "level"} ref={meter} aria-hidden="true">
        {Array.from({ length: BARS }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      {status === "uploading" && <p className="hint center-text">Creating your voice</p>}

      <div className="stack">
        <label className="check">
          <input
            type="checkbox"
            checked={consent}
            disabled={status !== "ready"}
            onChange={(e) => setConsent(e.target.checked)}
          />
          This is my own voice, and I agree to it being cloned for this call.
        </label>
        <p className="hint">Your recording is not stored. The voice profile is deleted within an hour.</p>

        {error && <p className="error">{error}</p>}

        {status === "recording" ? (
          <button type="button" className="primary" onClick={() => void upload()}>
            Finish
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={!consent || status === "uploading"}
            onClick={() => void record()}
          >
            Record
          </button>
        )}
        <button type="button" className="secondary" onClick={() => onDone()}>
          Use a stock voice instead
        </button>
      </div>
    </main>
  );
}
