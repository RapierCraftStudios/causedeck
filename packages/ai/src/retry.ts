// Retry with jittered exponential backoff, and a per-provider circuit breaker: 5 consecutive
// failures open it for 30 s, during which calls fail fast so the gateway can fail over.
import { CircuitOpenError, ProviderError } from './errors.ts';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 0 <= x < 1; injectable for tests. */
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Full jitter: a random delay up to `base * 2^attempt`, capped. */
export function backoffDelay(
  attempt: number,
  { baseDelayMs = 200, maxDelayMs = 5_000, random = Math.random }: RetryOptions = {},
): number {
  return Math.floor(random() * Math.min(maxDelayMs, baseDelayMs * 2 ** attempt));
}

/** Run `fn`, retrying `ProviderError`s marked retryable (throttling, transient 5xx). */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, sleep = defaultSleep } = opts;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || error instanceof CircuitOpenError || attempt + 1 >= maxAttempts) {
        throw error;
      }
      await sleep(backoffDelay(attempt, opts));
    }
  }
}

export interface BreakerOptions {
  threshold?: number;
  openMs?: number;
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly threshold: number;
  private readonly openMs: number;
  private readonly now: () => number;

  constructor({ threshold = 5, openMs = 30_000, now = () => Date.now() }: BreakerOptions = {}) {
    this.threshold = threshold;
    this.openMs = openMs;
    this.now = now;
  }

  get isOpen(): boolean {
    if (this.openedAt === null) return false;
    if (this.now() - this.openedAt >= this.openMs) {
      // Half-open: let one call through; a failure re-opens immediately.
      this.openedAt = null;
      this.failures = this.threshold - 1;
      return false;
    }
    return true;
  }

  /** Run `fn` unless the breaker is open; count its outcome. */
  async run<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    if (this.isOpen) throw new CircuitOpenError(provider);
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.threshold) this.openedAt = this.now();
      throw error;
    }
  }
}
