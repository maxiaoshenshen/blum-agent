import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./rate-limit";

describe("FixedWindowRateLimiter", () => {
  it("allows requests up to the configured limit", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({
      limit: 2,
      windowMs: 60_000,
      maxEntries: 10,
      now: () => now,
    });

    expect(limiter.attempt("203.0.113.10").allowed).toBe(true);
    expect(limiter.attempt("203.0.113.10").allowed).toBe(true);
    expect(limiter.attempt("203.0.113.10")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });

    now += 60_000;
    expect(limiter.attempt("203.0.113.10").allowed).toBe(true);
  });

  it("bounds stored identities and keeps other identities independent", () => {
    const limiter = new FixedWindowRateLimiter({
      limit: 1,
      windowMs: 60_000,
      maxEntries: 2,
      now: () => 1_000,
    });

    expect(limiter.attempt("a").allowed).toBe(true);
    expect(limiter.attempt("b").allowed).toBe(true);
    expect(limiter.attempt("c").allowed).toBe(true);
    expect(limiter.size).toBe(2);
    expect(limiter.attempt("b").allowed).toBe(false);
  });
});
