import type { IceServer } from "../shared/protocol";

const ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys";

/**
 * Short-lived TURN credentials from Cloudflare Realtime. Many mobile networks
 * in India put phones behind carrier-grade NAT, where STUN alone cannot open a
 * direct path, so video needs a relay.
 *
 * One set is shared by all new rooms and renewed in the background at half
 * its life, so starting a call never waits on Cloudflare. If Cloudflare is
 * unreachable, rooms get the STUN fallback and video works where it can.
 */
export class TurnCredentials {
  private servers: IceServer[] | null = null;
  private expiresAt = 0;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly keyId: string,
    private readonly apiToken: string,
    private readonly fallback: IceServer[],
    private readonly ttlSeconds = 24 * 60 * 60,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** The servers to hand a new room. Never blocks. */
  current(): IceServer[] {
    const now = this.now();
    if (now > this.expiresAt - (this.ttlSeconds * 1000) / 2) void this.refresh();
    return this.servers && now < this.expiresAt ? this.servers : this.fallback;
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.fetchServers().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async fetchServers(): Promise<void> {
    try {
      const startedAt = this.now();
      const response = await this.fetchFn(`${ENDPOINT}/${this.keyId}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: this.ttlSeconds }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { iceServers?: unknown };
      const servers = parseServers(body.iceServers);
      if (!servers.length) throw new Error("no ICE servers in reply");
      this.servers = servers;
      this.expiresAt = startedAt + this.ttlSeconds * 1000;
    } catch (error) {
      console.error("[turn] could not get credentials:", error instanceof Error ? error.message : error);
    }
  }
}

/** Keeps well-formed entries and drops port 53, which browsers block and only time out on. */
function parseServers(raw: unknown): IceServer[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: IceServer[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const { urls, username, credential } = entry as Record<string, unknown>;
    const all = (Array.isArray(urls) ? urls : [urls]).filter((u): u is string => typeof u === "string");
    const usable = all.filter((u) => !/:53(\?|$)/.test(u));
    if (!usable.length) continue;
    out.push({
      urls: usable,
      ...(typeof username === "string" ? { username } : {}),
      ...(typeof credential === "string" ? { credential } : {}),
    });
  }
  return out;
}
