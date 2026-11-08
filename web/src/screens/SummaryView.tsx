import { LANGUAGES } from "../../../shared/protocol";
import type { LanguageCode } from "../../../shared/protocol";
import { ArrowIcon, CheckIcon, Logo, SaveIcon, ShareIcon, SpeakerIcon } from "../icons";
import type { CallState } from "../state";
import { STRINGS } from "../strings";

export function SummaryView({
  state,
  language,
  onListen,
  onDone,
}: {
  state: CallState;
  language: LanguageCode;
  onListen: () => void;
  onDone: () => void;
}) {
  const text = STRINGS[language];
  const { summary, peer } = state;
  const peerLanguage = peer && LANGUAGES.find((l) => l.code === peer.language)?.native;

  const plainText = summary
    ? [text.keyPoints, ...summary.keyPoints, "", text.nextSteps, ...summary.nextSteps].join("\n")
    : "";

  const share = async () => {
    if (navigator.share) await navigator.share({ text: plainText }).catch(() => undefined);
    else await navigator.clipboard.writeText(plainText);
  };

  const save = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([plainText], { type: "text/plain;charset=utf-8" }));
    link.download = "dubhashi-summary.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main className="page" lang={language}>
      <header className="brand">
        <Logo />
        <div>
          <h1>{text.summaryTitle}</h1>
          {peer && (
            <p>
              {peer.name} · {peerLanguage}
            </p>
          )}
        </div>
      </header>

      {!summary ? (
        <div className="card loading">
          <span className="spinner dark" />
          <p className="hint">{text.preparing}</p>
        </div>
      ) : (
        <div className="stack">
          <section className="card">
            <h2>{text.keyPoints}</h2>
            {summary.keyPoints.length ? (
              <ul className="points">
                {summary.keyPoints.map((point) => (
                  <li key={point}>
                    <CheckIcon />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">{text.nothingSaid}</p>
            )}
          </section>
          {summary.nextSteps.length > 0 && (
            <section className="card next">
              <h2>{text.nextSteps}</h2>
              <ul className="points">
                {summary.nextSteps.map((step) => (
                  <li key={step}>
                    <ArrowIcon />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {state.relationship === "doctor" && <p className="hint">{text.medicalNote}</p>}
          <button type="button" className="primary with-icon" onClick={onListen}>
            <SpeakerIcon size={20} />
            {text.listen}
          </button>
          <div className="row">
            <button type="button" className="secondary with-icon" onClick={save}>
              <SaveIcon />
              {text.save}
            </button>
            <button type="button" className="secondary with-icon" onClick={() => void share()}>
              <ShareIcon />
              {text.share}
            </button>
          </div>
        </div>
      )}

      <button type="button" className="ghost" onClick={onDone}>
        {text.newCall}
      </button>
    </main>
  );
}
