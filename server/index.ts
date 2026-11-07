import { createApp } from "./app";
import { loadConfig } from "./config";
import { GnaniSpeech } from "./providers/gnani";
import { LlmTranslator } from "./providers/llm";
import { MockSpeech, MockTranslator } from "./providers/mock";

const config = loadConfig();

const { server } = createApp({
  config,
  speech: config.mock ? new MockSpeech() : new GnaniSpeech(config),
  translator: config.mock ? new MockTranslator() : new LlmTranslator(config),
  staticDir: "dist",
});

server.listen(config.port, () => {
  console.log(`Dubhashi on http://localhost:${config.port}${config.mock ? " (mock providers)" : ""}`);
});
