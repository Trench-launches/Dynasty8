import "server-only";

/**
 * Fixed-window counters, used for two things:
 *  1. Inbound API abuse protection (per client IP, per route group).
 *  2. Outbound provider budgets (e.g. GeckoTerminal's ~10 calls/min free tier), so a
 *     burst of chart requests can never exhaust a provider quota.
 * In-memory per instance; swap for Redis when running several instances.
 */
export interface RateLimiter {
  /** Returns true when the call is allowed (and consumes one unit). */
  take(key: string): boolean;
  /** Seconds until the window for `key` resets. */
  resetIn(key: string): number;
  reset(): void;
}

export function createRateLimiter(limit: number, windowMs: number, now = () => Date.now()): RateLimiter {
  const buckets = new Map<string, { count: number; start: number }>();
  return {
    take(key) {
      const t = now();
      const b = buckets.get(key);
      if (!b || t - b.start >= windowMs) {
        if (buckets.size > 10_000) buckets.clear();
        buckets.set(key, { count: 1, start: t });
        return true;
      }
      if (b.count >= limit) return false;
      b.count++;
      return true;
    },
    resetIn(key) {
      const b = buckets.get(key);
      return b ? Math.max(0, Math.ceil((b.start + windowMs - now()) / 1000)) : 0;
    },
    reset() {
      buckets.clear();
    },
  };
}

export const publicApiLimiter = createRateLimiter(120, 60_000);
export const adminApiLimiter = createRateLimiter(30, 60_000);
/** Outbound budgets, kept under each provider's documented limit. */
export const providerBudgets = {
  geckoterminal: createRateLimiter(8, 60_000), // documented ~10/min, varies with load
  dexscreener: createRateLimiter(250, 60_000), // documented 300/min for pair endpoints
  birdeye: createRateLimiter(50, 60_000),
  helius: createRateLimiter(60, 60_000),
  solanaRpc: createRateLimiter(60, 60_000),
};
