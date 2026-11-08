import { Logo } from "../icons";
import { STRINGS } from "../strings";
import type { SavedCall } from "../useCall";

/** Shown after a reload. Rejoining needs a tap, or the phone keeps audio muted. */
export function Rejoin({
  saved,
  onRejoin,
  onLeave,
}: {
  saved: SavedCall;
  onRejoin: () => void;
  onLeave: () => void;
}) {
  const text = STRINGS[saved.profile.language];
  return (
    <main className="page center waiting" lang={saved.profile.language}>
      <div className="beacon">
        <Logo size={64} />
      </div>
      <h1>{text.rejoinTitle}</h1>
      <p className="hint">{text.rejoinHint}</p>
      <button type="button" className="primary" onClick={onRejoin}>
        {text.rejoin}
      </button>
      <button type="button" className="ghost" onClick={onLeave}>
        {text.leave}
      </button>
    </main>
  );
}
