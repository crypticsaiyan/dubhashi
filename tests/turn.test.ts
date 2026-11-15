import { describe, expect, it, vi } from "vitest";
import { TurnCredentials } from "../server/turn";

const FALLBACK = [{ urls: "stun:stun.l.google.com:19302" }];
const REPLY = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "user",
      credential: "secret",
    },
  ],
};

function setup(reply: () => Promise<Response>) {
  let now = 1_000_000;
  const fetchFn = vi.fn(reply);
  const turn = new TurnCredentials("key", "token", FALLBACK, 3600, fetchFn as unknown as typeof fetch, () => now);
  return { turn, fetchFn, advance: (ms: number) => (now += ms) };
}

const ok = () => Promise.resolve(new Response(JSON.stringify(REPLY), { status: 201 }));

describe("TURN credentials", () => {
  it("asks Cloudflare with the key and token, and drops port 53", async () => {
    const { turn, fetchFn } = setup(ok);
    await turn.refresh();
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/generate-ice-servers");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
    expect(JSON.parse(init.body as string)).toEqual({ ttl: 3600 });
    expect(turn.current()).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
        username: "user",
        credential: "secret",
      },
    ]);
  });

  it("falls back to STUN when Cloudflare refuses", async () => {
    const { turn } = setup(() => Promise.resolve(new Response("no", { status: 401 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await turn.refresh();
    expect(turn.current()).toBe(FALLBACK);
  });

  it("renews at half life without blocking, and never serves expired credentials", async () => {
    const { turn, fetchFn, advance } = setup(ok);
    await turn.refresh();
    turn.current();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    advance(31 * 60 * 1000);
    expect(turn.current()[1]?.username).toBe("user");
    expect(fetchFn).toHaveBeenCalledTimes(2);

    // Renewal failed and the old set ran out.
    fetchFn.mockImplementation(() => Promise.reject(new Error("offline")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    advance(60 * 60 * 1000);
    expect(turn.current()).toBe(FALLBACK);
  });

  it("shares one request between overlapping refreshes", async () => {
    const { turn, fetchFn } = setup(ok);
    await Promise.all([turn.refresh(), turn.refresh(), turn.refresh()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
