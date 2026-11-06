export class RateLimitError extends Error {
  constructor(message = "Rate limited") {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface SerialQueueOptions {
  /** Minimum gap between the start of consecutive tasks. */
  minGapMs: number;
  /** Retries for RateLimitError, with exponential backoff from retryBaseMs. */
  maxRetries: number;
  retryBaseMs: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs tasks one at a time. Gnani's free tier allows one active request per
 * key, so every room must share a single queue for that key.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = 0;

  constructor(private readonly options: SerialQueueOptions) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => this.execute(task));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async execute<T>(task: () => Promise<T>): Promise<T> {
    const { minGapMs, maxRetries, retryBaseMs } = this.options;
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastStart + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastStart = Date.now();
      try {
        return await task();
      } catch (error) {
        if (!(error instanceof RateLimitError) || attempt >= maxRetries) throw error;
        await sleep(retryBaseMs * 2 ** attempt);
      }
    }
  }
}

/** Fixed-window counter used to limit abuse of paid endpoints per client IP. */
export class WindowLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.hits.size > 10_000) this.hits.clear();
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }
}
