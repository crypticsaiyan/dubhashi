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
