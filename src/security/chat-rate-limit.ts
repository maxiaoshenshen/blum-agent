import { FixedWindowRateLimiter } from "./rate-limit";

// Shared by both answer endpoints so switching between streaming and JSON
// cannot double the per-client request budget.
export const chatRateLimiter = new FixedWindowRateLimiter({
  limit: 30,
  windowMs: 60_000,
  maxEntries: 10_000,
});
