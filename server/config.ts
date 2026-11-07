import { existsSync } from "node:fs";
import type { IceServer } from "../shared/protocol";
import { DEFAULT_ICE_SERVERS } from "./room";

export interface Config {
  port: number;
  mock: boolean;
  gnaniApiKey: string;
  gnaniBaseUrl: string;
  gnaniWsUrl: string;
  ttsModel: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  allowedOrigins: string[];
  iceServers: IceServer[];
}

/** ICE_SERVERS is a JSON array, e.g. to add a TURN server for strict mobile networks. */
function parseIceServers(raw: string | undefined): IceServer[] {
  if (!raw) return DEFAULT_ICE_SERVERS;
  const parsed: unknown = JSON.parse(raw);
  const valid =
    Array.isArray(parsed) &&
    parsed.every(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        (typeof s.urls === "string" || (Array.isArray(s.urls) && s.urls.every((u: unknown) => typeof u === "string"))),
    );
  if (!valid) throw new Error("ICE_SERVERS must be a JSON array of { urls, username?, credential? }.");
  return parsed as IceServer[];
}

export function loadConfig(): Config {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const env = process.env;
  const mock = env.MOCK_AI === "1";
  const config: Config = {
    port: Number(env.PORT ?? 8787),
    mock,
    gnaniApiKey: env.GNANI_API_KEY ?? "",
    gnaniBaseUrl: env.GNANI_BASE_URL ?? "https://api.vachana.ai",
    gnaniWsUrl: env.GNANI_WS_URL ?? "wss://api.vachana.ai/stt/v3/stream",
    ttsModel: env.TTS_MODEL ?? "timbre-v3.0",
    llmBaseUrl: env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1",
    llmApiKey: env.LLM_API_KEY ?? "",
    llmModel: env.LLM_MODEL ?? "google/gemma-4-31b-it",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
    iceServers: parseIceServers(env.ICE_SERVERS),
  };
  if (!mock) {
    const missing = [
      !config.gnaniApiKey && "GNANI_API_KEY",
      !config.llmApiKey && "LLM_API_KEY",
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(
        `Missing ${missing.join(", ")}. Add to .env, or run with MOCK_AI=1 for fake providers.`,
      );
    }
  }
  return config;
}
