import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, PointerEvent } from "react";
import { LANGUAGES, MAX_TYPED_CHARS } from "../../../shared/protocol";
import type { LanguageCode, NoticeCode, Phase, Profile, TurnMetrics } from "../../../shared/protocol";
import {
  CameraIcon,
  EndIcon,
  KeyboardIcon,
  Logo,
  MicIcon,
  ReplayIcon,
  SendIcon,
  ShareIcon,
  SpeakerIcon,
} from "../icons";
import { STRINGS } from "../strings";
import type { Strings } from "../strings";
import type { useCall } from "../useCall";

const native = (code: LanguageCode) => LANGUAGES.find((l) => l.code === code)?.native ?? code;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const NOTICE_KEYS: Record<NoticeCode, keyof Strings> = {
  not_heard: "notHeard",
  busy: "busy",
  peer_offline: "peerOffline",
  turn_failed: "turnFailed",
  voice_fallback: "voiceFallback",
  voice_failed: "voiceFailed",
  turn_limit: "turnLimit",
};

const buzz = (ms: number) => navigator.vibrate?.(ms);

export function Call({
  call,
  profile,
  onBack,
}: {
  call: ReturnType<typeof useCall>;
  profile: Profile;
  onBack: () => void;
}) {
  const { state } = call;
  const text = STRINGS[profile.language];
  const [holding, setHolding] = useState(false);
  const [ending, setEnding] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const talkButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.entries.length, state.confirm, state.phase]);

  useEffect(() => {
    if (!state.notice) return;
    const timer = setTimeout(call.clearNotice, 5000);
    return () => clearTimeout(timer);
    // clearNotice dispatches to a stable reducer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.notice]);

  // A phone that sleeps mid-call drops the mic and the connection.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      navigator.wakeLock
        .request("screen")
        .then((sentinel) => {
          lock = sentinel;
        })
        .catch(() => undefined);
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  // Drives the ring around the talk button from the mic level, without re-rendering.
  useEffect(() => {
    if (!holding) {
      talkButton.current?.style.setProperty("--level", "0");
      return;
    }
    let frame = 0;
    const tick = () => {
      talkButton.current?.style.setProperty("--level", call.mic.level.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [holding, call.mic]);

  if (state.error && !state.code) {
    return (
      <main className="page center">
        <p className="error">{state.error}</p>
        <button type="button" className="primary" onClick={onBack}>
          Back
        </button>
      </main>
    );
  }

  if (state.phase === "waiting" || !state.peer) {
    return <Waiting code={state.code} text={text} language={profile.language} mock={state.mock} />;
  }

  const peer = state.peer;
  const mineActive = state.activeMemberId === state.memberId;
  const canTalk = state.phase === "idle" && peer.online;
  const busy = state.phase === "translating" || state.phase === "confirming";
  const label = holding
    ? text.speaking
    : state.phase === "speaking" && !mineActive
      ? text.peerTalking
      : busy
        ? text.translating
        : state.phase === "playing"
          ? text.playing
          : text.hold;

  const press = () => {
    if (!canTalk || holding) return;
    buzz(15);
    setHolding(true);
    call.talkStart();
  };
  const release = () => {
    if (!holding) return;
    buzz(10);
    setHolding(false);
    call.talkEnd();
  };
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    press();
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, down: boolean) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.repeat) return;
    if (down) press();
    else release();
  };

  const sendTyped = (event: FormEvent) => {
    event.preventDefault();
    const typed = draft.trim();
    if (!typed || !canTalk) return;
    call.sendText(typed);
    setDraft("");
  };

  // One stray tap must not end the call.
  const endCall = () => {
    if (ending) return call.endCall();
    setEnding(true);
    setTimeout(() => setEnding(false), 3000);
  };

  const cameraOn = call.video.local !== null;
  const toggleCamera = () => {
    setCameraBlocked(false);
    call.toggleCamera().catch(() => setCameraBlocked(true));
  };

  const notice = cameraBlocked
    ? text.cameraBlocked
    : state.notice
      ? text[NOTICE_KEYS[state.notice]]
      : null;
  const lastHeard = state.entries.findLast((entry) => !entry.mine);
  const peerBusy = !mineActive && state.phase !== "idle" && state.phase !== "playing";

  return (
    <main className={typing ? "call composing" : "call"}>
      <header className="call-bar">
        <div className="who">
          <span className={peer.online ? "avatar online" : "avatar"} aria-hidden="true">
            {peer.name.trim().charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{peer.name}</strong>
            <span lang={peer.language}>
              {native(peer.language)} · {peer.online ? text.connected : text.reconnecting}
            </span>
          </div>
        </div>
        <div className={ending ? "actions ending" : "actions"}>
          {!ending && (
            <button
              type="button"
              className={cameraOn ? "camera on" : "camera"}
              disabled={!peer.online && !cameraOn}
              onClick={toggleCamera}
              aria-pressed={cameraOn}
              aria-label={cameraOn ? text.cameraOff : text.cameraOn}
              title={cameraOn ? text.cameraOff : text.cameraOn}
            >
              <CameraIcon off={!cameraOn} />
            </button>
          )}
          <button
            type="button"
            className={ending ? "end confirm-end" : "end"}
            onClick={endCall}
            aria-label={ending ? text.endConfirm : text.endCall}
          >
            <EndIcon />
            <span>{ending ? text.endConfirm : text.endCall}</span>
          </button>
        </div>
      </header>

      {state.mock && <MockBanner />}

      {(call.video.remote || call.video.frame || call.video.local) && (
        <section className="stage">
          {call.video.remote ? (
            <VideoTile stream={call.video.remote} className="remote" />
          ) : call.video.frame ? (
            <img src={call.video.frame} className="remote" alt="" />
          ) : (
            <div className="remote off">
              <span className="avatar big">{peer.name.trim().charAt(0).toUpperCase()}</span>
            </div>
          )}
          {call.video.local && <VideoTile stream={call.video.local} className="self" />}
          {lastHeard && (
            <p className="caption" lang={profile.language} key={lastHeard.turnId}>
              {lastHeard.text}
            </p>
          )}
        </section>
      )}

      <section className="transcript" aria-live="polite">
        {state.entries.length === 0 && !state.confirm && (
          <div className="empty">
            <p className="pair">
              <span lang={profile.language}>{native(profile.language)}</span>
              <span className="swap" aria-hidden="true">
                ⇄
              </span>
              <span lang={peer.language}>{native(peer.language)}</span>
            </p>
            <p className="hint">{text.emptyHint}</p>
          </div>
        )}

        {state.entries.map((entry) => {
          const playing = !entry.mine && state.playingTurn === entry.turnId;
          return (
            <article
              key={`${entry.mine}-${entry.turnId}`}
              className={["bubble", entry.mine && "mine", playing && "playing"].filter(Boolean).join(" ")}
            >
              <p lang={profile.language}>{entry.text}</p>
              {entry.theyHeard && (
                <p className="heard">
                  <span>{text.heard}:</span> {entry.theyHeard}
                </p>
              )}
              {!entry.mine && (
                <button
                  type="button"
                  className="replay"
                  disabled={playing || !call.canReplay(entry.turnId)}
                  onClick={() => call.replay(entry.turnId)}
                >
                  {playing ? <Bars /> : <ReplayIcon />}
                  {playing ? text.playing : text.replay}
                </button>
              )}
            </article>
          );
        })}

        {peerBusy && (
          <article className="bubble typing" aria-label={label}>
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{state.phase === "speaking" ? text.peerTalking : text.translating}</span>
          </article>
        )}

        {state.confirm && (
          <article className="confirm">
            <h2>{text.confirm}</h2>
            {state.confirm.mismatch && <p className="warn">{text.numberWarn}</p>}
            <ul>
              {state.confirm.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={() => state.confirm && call.confirm(state.confirm.turnId, true)}
              >
                {text.yes}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => state.confirm && call.confirm(state.confirm.turnId, false)}
              >
                {text.again}
              </button>
            </div>
          </article>
        )}
        <div ref={bottom} />
      </section>

      <footer className="controls">
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <Pipeline phase={state.phase} metrics={state.metrics} text={text} />
        {typing && (
          <form className="composer" onSubmit={sendTyped}>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setTyping(false)}
              maxLength={MAX_TYPED_CHARS}
              placeholder={text.typePlaceholder}
              aria-label={text.typePlaceholder}
              lang={profile.language}
              enterKeyHint="send"
            />
            <button type="submit" className="send" disabled={!canTalk || !draft.trim()} aria-label={text.send}>
              <SendIcon />
            </button>
          </form>
        )}
        <div className="talk-row">
          <button
            type="button"
            className={typing ? "side on" : "side"}
            onClick={() => setTyping((open) => !open)}
            aria-pressed={typing}
            aria-label={text.typeInstead}
            title={text.typeInstead}
          >
            <KeyboardIcon />
          </button>
          <button
            ref={talkButton}
            type="button"
            className={["talk", holding && "holding", busy && "busy"].filter(Boolean).join(" ")}
            disabled={!canTalk && !holding}
            aria-label={label}
            onPointerDown={onPointerDown}
            onPointerUp={release}
            onPointerCancel={release}
            onKeyDown={(event) => onKey(event, true)}
            onKeyUp={(event) => onKey(event, false)}
            onContextMenu={(event) => event.preventDefault()}
          >
            {busy ? (
              <span className="spinner" />
            ) : state.phase === "playing" ? (
              <SpeakerIcon size={40} />
            ) : (
              <MicIcon size={40} />
            )}
          </button>
          <span className="side-spacer" aria-hidden="true" />
        </div>
        <p className="talk-label" lang={profile.language}>
          {label}
        </p>
      </footer>
    </main>
  );
}

const STEPS: { key: "stepHear" | "stepTranslate" | "stepSpeak"; phases: Phase[] }[] = [
  { key: "stepHear", phases: ["speaking"] },
  { key: "stepTranslate", phases: ["translating", "confirming"] },
  { key: "stepSpeak", phases: ["playing"] },
];

/** Shows where the turn is while it runs, and how long each stage took after. */
function Pipeline({ phase, metrics, text }: { phase: Phase; metrics: TurnMetrics | null; text: Strings }) {
  const current = STEPS.findIndex((step) => step.phases.includes(phase));
  if (current === -1) {
    return metrics ? (
      <p className="timing" aria-label="Last turn timing">
        <span>Prisma {seconds(metrics.sttMs)}</span>
        <span>LLM {seconds(metrics.llmMs)}</span>
        <span>Timbre {seconds(metrics.ttsMs)}</span>
        <strong>{seconds(metrics.totalMs)}</strong>
      </p>
    ) : (
      <p className="timing" />
    );
  }
  return (
    <ol className="steps">
      {STEPS.map((step, index) => (
        <li key={step.key} className={index < current ? "done" : index === current ? "now" : ""}>
          {text[step.key]}
        </li>
      ))}
    </ol>
  );
}

function Waiting({
  code,
  text,
  language,
  mock,
}: {
  code: string | null;
  text: Strings;
  language: LanguageCode;
  mock: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const link = code ? `${location.origin}/?code=${code}` : "";
  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title: "Dubhashi", url: link }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    }
  };
  return (
    <main className="page center waiting" lang={language}>
      <div className="beacon">
        <Logo size={64} />
      </div>
      <p className="eyebrow">{text.waiting}</p>
      <p className="room-code" aria-label={code ?? ""}>
        {(code ?? "······").split("").map((char, index) => (
          <span key={index}>{char}</span>
        ))}
      </p>
      <p className="hint">{text.shareHint}</p>
      <button type="button" className="primary with-icon" disabled={!code} onClick={() => void share()}>
        <ShareIcon />
        {copied ? text.copied : text.shareLink}
      </button>
      {mock && <MockBanner />}
    </main>
  );
}

function VideoTile({ stream, className }: { stream: MediaStream; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    // Some phone browsers skip autoplay when the stream is attached late.
    video.play().catch(() => {});
  }, [stream]);
  // Muted: video carries no sound, and muted video may autoplay on phones.
  return <video ref={ref} className={className} autoPlay playsInline muted />;
}

function Bars() {
  return (
    <span className="bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function MockBanner() {
  return <p className="mock">Mock mode: speech and translation are simulated.</p>;
}
