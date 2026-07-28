interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  maxEntries: number;
  now?: () => number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, WindowEntry>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimiterOptions) {
    if (
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      !Number.isInteger(options.windowMs) ||
      options.windowMs < 1 ||
      !Number.isInteger(options.maxEntries) ||
      options.maxEntries < 1
    ) {
      throw new Error("Rate limiter options must be positive integers.");
    }
    this.now = options.now ?? Date.now;
  }

  get size() {
    return this.entries.size;
  }

  attempt(identity: string): RateLimitDecision {
    const now = this.now();
    const existing = this.entries.get(identity);

    if (!existing || existing.resetAt <= now) {
      if (!existing) this.makeRoom(now);
      this.entries.set(identity, {
        count: 1,
        resetAt: now + this.options.windowMs,
      });
      return {
        allowed: true,
        retryAfterSeconds: Math.ceil(this.options.windowMs / 1_000),
      };
    }

    if (existing.count >= this.options.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.resetAt - now) / 1_000),
        ),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1_000),
      ),
    };
  }

  private makeRoom(now: number) {
    if (this.entries.size < this.options.maxEntries) return;

    for (const [identity, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(identity);
    }

    while (this.entries.size >= this.options.maxEntries) {
      const oldestIdentity = this.entries.keys().next().value as
        | string
        | undefined;
      if (!oldestIdentity) break;
      this.entries.delete(oldestIdentity);
    }
  }
}
