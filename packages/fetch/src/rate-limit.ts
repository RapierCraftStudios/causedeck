// A sliding-window limiter on the injected clock. In-memory: it holds per process (ADR 0034).

export interface RateLimiter {
  /** Whether `key` has room for one more hit in the window. Does not record. */
  canAcquire(key: string, limit: number, windowMs: number): boolean;
  /** Record one hit; false (nothing recorded) when the window is full. */
  tryAcquire(key: string, limit: number, windowMs: number): boolean;
}

export function createRateLimiter(now: () => number): RateLimiter {
  const hits = new Map<string, number[]>();

  const live = (key: string, windowMs: number): number[] => {
    const cutoff = now() - windowMs;
    const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
    hits.set(key, kept);
    return kept;
  };

  return {
    canAcquire: (key, limit, windowMs) => live(key, windowMs).length < limit,
    tryAcquire: (key, limit, windowMs) => {
      const kept = live(key, windowMs);
      if (kept.length >= limit) return false;
      kept.push(now());
      return true;
    },
  };
}
