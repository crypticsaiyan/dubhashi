import { useState } from "react";
import type { FormEvent } from "react";
import { LANGUAGES, RELATIONSHIPS } from "../../../shared/protocol";
import type { Gender, LanguageCode, Profile, Relationship } from "../../../shared/protocol";
import { ArrowIcon, Logo, MicIcon, RELATIONSHIP_ICONS } from "../icons";

export type StartChoice = { profile: Profile; ownVoice: boolean } & (
  | { mode: "create"; relationship: Relationship }
  | { mode: "join"; code: string }
);

const RELATIONSHIP_NOTES: Record<Relationship, string> = {
  doctor: "Doses and numbers double-checked",
  elder: "Extra respectful",
  employer: "Money and dates double-checked",
  friend: "Warm and casual",
};

const GREETINGS = ["नमस्ते", "வணக்கம்", "নমস্কার", "ನಮಸ್ಕಾರ", "నమస్కారం", "നമസ്കാരം", "નમસ્તે", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ"];

export function Start({ onContinue }: { onContinue: (choice: StartChoice) => void }) {
  const linkedCode = new URLSearchParams(location.search).get("code")?.toUpperCase() ?? "";
  const [joining, setJoining] = useState(Boolean(linkedCode));
  const [code, setCode] = useState(linkedCode);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<LanguageCode>("hi-IN");
  const [gender, setGender] = useState<Gender>("female");
  const [relationship, setRelationship] = useState<Relationship>("doctor");
  const [ownVoice, setOwnVoice] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const profile: Profile = { name: name.trim(), language, gender };
    onContinue(
      joining
        ? { mode: "join", code: code.trim().toUpperCase(), profile, ownVoice }
        : { mode: "create", relationship, profile, ownVoice },
    );
  };

  return (
    <main className="page">
      <header className="brand">
        <Logo />
        <div>
          <h1>Dubhashi</h1>
          <p>Talk in your language. They hear theirs.</p>
        </div>
      </header>
      <p className="greetings" aria-hidden="true">
        {GREETINGS.map((word) => (
          <span key={word}>{word}</span>
        ))}
      </p>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!joining}
          className={joining ? "" : "active"}
          onClick={() => setJoining(false)}
        >
          Start a call
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={joining}
          className={joining ? "active" : ""}
          onClick={() => setJoining(true)}
        >
          Join a call
        </button>
      </div>

      <form className="stack" onSubmit={submit}>
        {joining && (
          <label>
            Call code
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              className="code-input"
              placeholder="ABC123"
            />
          </label>
        )}

        <label>
          Your name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            autoComplete="given-name"
          />
        </label>

        <fieldset>
          <legend>I speak</legend>
          <div className="choices languages">
            {LANGUAGES.map((l) => (
              <label key={l.code} className={language === l.code ? "choice active" : "choice"}>
                <input
                  type="radio"
                  name="language"
                  checked={language === l.code}
                  onChange={() => setLanguage(l.code)}
                />
                <span className="native" lang={l.code}>
                  {l.native}
                </span>
                {l.native !== l.name && <span className="sub">{l.name}</span>}
              </label>
            ))}
          </div>
        </fieldset>

        {!joining && (
          <fieldset>
            <legend>Talking to</legend>
            <div className="choices relations">
              {RELATIONSHIPS.map((r) => (
                <label key={r.id} className={relationship === r.id ? "choice active" : "choice"}>
                  <input
                    type="radio"
                    name="relationship"
                    checked={relationship === r.id}
                    onChange={() => setRelationship(r.id)}
                  />
                  <span className="icon">{RELATIONSHIP_ICONS[r.id]}</span>
                  <span className="native">{r.label}</span>
                  <span className="sub">{RELATIONSHIP_NOTES[r.id]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>They hear a voice that is</legend>
          <div className="segmented">
            {(["female", "male"] as const).map((value) => (
              <label key={value} className={gender === value ? "active" : ""}>
                <input
                  type="radio"
                  name="gender"
                  checked={gender === value}
                  onChange={() => setGender(value)}
                />
                {value === "female" ? "Female" : "Male"}
              </label>
            ))}
          </div>
        </fieldset>

        <label className={ownVoice ? "toggle on" : "toggle"}>
          <span className="icon">
            <MicIcon />
          </span>
          <span className="toggle-text">
            <strong>Speak in my own voice</strong>
            <span>They hear you, in their language. Takes 15 seconds to set up.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={ownVoice}
            onChange={(e) => setOwnVoice(e.target.checked)}
          />
        </label>

        <button type="submit" className="primary with-icon">
          {joining ? "Join call" : "Start call"}
          <ArrowIcon />
        </button>
      </form>
    </main>
  );
}
