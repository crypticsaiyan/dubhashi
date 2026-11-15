import { createApp } from "./app";
import { loadConfig } from "./config";
import { GnaniSpeech } from "./providers/gnani";
import { LlmTranslator } from "./providers/llm";
import { MockSpeech, MockTranslator } from "./providers/mock";
import { TurnCredentials } from "./turn";

const config = loadConfig();

let turn: TurnCredentials | null = null;
if (config.turnKeyId && config.turnApiToken) {
  turn = new TurnCredentials(config.turnKeyId, config.turnApiToken, config.iceServers);
  await turn.refresh();
} else {
  console.log("No CF_TURN_KEY_ID / CF_TURN_API_TOKEN: video uses STUN only and may fail on mobile data.");
}

const { server } = createApp({
  config,
  speech: config.mock ? new MockSpeech() : new GnaniSpeech(config),
  translator: config.mock ? new MockTranslator() : new LlmTranslator(config),
  staticDir: "dist",
  ...(turn ? { iceServers: () => turn.current() } : {}),
});

server.listen(config.port, () => {
  console.log(`Dubhashi on http://localhost:${config.port}${config.mock ? " (mock providers)" : ""}`);
});

// Render's free plan sleeps after 15 idle minutes and takes about a minute to
// wake. Render sets RENDER_EXTERNAL_URL; a request to it goes out and back in
// through Render's proxy, so it counts as traffic and keeps the service awake.
const publicUrl = process.env.RENDER_EXTERNAL_URL;
if (publicUrl && process.env.KEEP_AWAKE !== "0") {
  setInterval(() => {
    fetch(`${publicUrl}/healthz`, { signal: AbortSignal.timeout(10_000) }).catch((error: unknown) => {
      console.error("[keep-awake]", error instanceof Error ? error.message : error);
    });
  }, 10 * 60 * 1000).unref();
  console.log(`Keep-awake: pinging ${publicUrl}/healthz every 10 minutes`);
}
