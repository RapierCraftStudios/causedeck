// Per-workspace token bucket for resolver calls. In memory and per process: it smooths bursts; the
// hard daily budget is counted from stored rows by the caller.
export interface RateLimiter {
  /** True and one token spent, or false when the workspace's bucket is empty. */
  tryAcquire(workspaceId: string): boolean;
}

export function createRateLimiter({
  capacity = 30,
  refillPerSecond = 2,
  now = () => Date.now(),
}: { capacity?: number; refillPerSecond?: number; now?: () => number } = {}): RateLimiter {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    tryAcquire(workspaceId) {
      const t = now();
      const bucket = buckets.get(workspaceId) ?? { tokens: capacity, at: t };
      bucket.tokens = Math.min(capacity, bucket.tokens + ((t - bucket.at) / 1000) * refillPerSecond);
      bucket.at = t;
      const allowed = bucket.tokens >= 1;
      if (allowed) bucket.tokens -= 1;
      buckets.set(workspaceId, bucket);
      return allowed;
    },
  };
}
