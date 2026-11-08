import { useState } from "react";
import type { ClientMessage, Profile, Relationship } from "../../shared/protocol";
import { Call } from "./screens/Call";
import { Rejoin } from "./screens/Rejoin";
import { Start } from "./screens/Start";
import type { StartChoice } from "./screens/Start";
import { SummaryView } from "./screens/SummaryView";
import { Voice } from "./screens/Voice";
import { loadSavedCall, useCall } from "./useCall";
import type { SavedCall } from "./useCall";

type Stage =
  | { name: "start" }
  | { name: "rejoin"; saved: SavedCall } | { name: "voice"; choice: StartChoice } | { name: "call"; profile: Profile };

function firstMessage(choice: StartChoice, profile: Profile): ClientMessage {
  return choice.mode === "create"
    ? { type: "create", relationship: choice.relationship as Relationship, ...profile }
    : { type: "join", code: choice.code, ...profile };
}

export function App() {
  const call = useCall();
  const [stage, setStage] = useState<Stage>(() => {
    const saved = loadSavedCall();
    return saved ? { name: "rejoin", saved } : { name: "start" };
  });

  const begin = (choice: StartChoice, voiceId?: string) => {
    const profile: Profile = { ...choice.profile, voiceId };
    void call.start(firstMessage(choice, profile));
    setStage({ name: "call", profile });
  };

  const restart = () => {
    call.leave();
    location.href = "/";
  };

  if (stage.name === "rejoin") {
    const { saved } = stage;
    return (
      <Rejoin
        saved={saved}
        onRejoin={() => {
          void call.resume(saved);
          setStage({ name: "call", profile: saved.profile });
        }}
        onLeave={restart}
      />
    );
  }

  if (stage.name === "start") {
    return (
      <Start
        onContinue={(choice) => {
          call.unlockAudio();
          if (choice.ownVoice) setStage({ name: "voice", choice });
          else begin(choice);
        }}
      />
    );
  }

  if (stage.name === "voice") {
    return (
      <Voice
        mic={call.mic}
        language={stage.choice.profile.language}
        onDone={(voiceId) => begin(stage.choice, voiceId)}
      />
    );
  }

  if (call.state.phase === "ended") {
    return (
      <SummaryView
        state={call.state}
        language={stage.profile.language}
        onListen={call.listenSummary}
        onDone={restart}
      />
    );
  }

  return <Call call={call} profile={stage.profile} onBack={restart} />;
}
