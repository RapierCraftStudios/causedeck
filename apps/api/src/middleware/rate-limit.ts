// Fixed-window rate limiting (#14): 120 requests/min per user, per client IP when anonymous, with
// IETF `RateLimit-*` headers and a 429 `RATE_LIMITED` problem. Route groups (path prefixes) get
// their own limits and counters. The in-memory store suits one instance; a shared store (Postgres
// or Redis) can replace it behind `RateLimitStore` when the API scales out.
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';

import { RateLimitedError } from '../errors.ts';
import type { AppEnv } from '../lib/openapi.ts';

import { longestPrefixMatch } from './body-limit.ts';

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitRule = { limit: 120, windowMs: 60_000 };

export interface RateLimitHit {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  /** Count one request against `key` in the current window. */
  hit(key: string, windowMs: number, now: number): Promise<RateLimitHit>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  readonly #windows = new Map<string, RateLimitHit>();

  hit(key: string, windowMs: number, now: number): Promise<RateLimitHit> {
    let window = this.#windows.get(key);
    if (window === undefined || window.resetAt <= now) {
      if (this.#windows.size > 10_000) this.#sweep(now);
      window = { count: 0, resetAt: now + windowMs };
      this.#windows.set(key, window);
    }
    window.count += 1;
    return Promise.resolve({ ...window });
  }

  #sweep(now: number): void {
    for (const [key, window] of this.#windows) if (window.resetAt <= now) this.#windows.delete(key);
  }
}

export interface RateLimitOptions {
  store?: RateLimitStore;
  default?: RateLimitRule;
  /** Path prefix → rule, e.g. `{ '/v1/exports': { limit: 10, windowMs: 60_000 } }`. */
  groups?: Record<string, RateLimitRule>;
  /** Trust the first `x-forwarded-for` hop (only behind a proxy that overwrites it). */
  trustProxy?: boolean;
  now?: () => number;
}

export function clientIp(c: Context<AppEnv>, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    // `app.request()` in tests has no socket.
    return 'unknown';
  }
}

export function rateLimit(options: RateLimitOptions = {}): MiddlewareHandler<AppEnv> {
  const store = options.store ?? new MemoryRateLimitStore();
  const fallback = options.default ?? DEFAULT_RATE_LIMIT;
  const now = options.now ?? Date.now;
  const trustProxy = options.trustProxy ?? false;

  return async (c, next) => {
    const match = longestPrefixMatch(c.req.path, options.groups);
    const [group, rule] = match ?? ['default', fallback];
    const principal = c.get('principal');
    const subject = principal ? `user:${principal.user.id}` : `ip:${clientIp(c, trustProxy)}`;
    const at = now();
    const { count, resetAt } = await store.hit(`${group}|${subject}`, rule.windowMs, at);
    const resetSeconds = Math.max(0, Math.ceil((resetAt - at) / 1000));
    const headers = {
      'ratelimit-limit': String(rule.limit),
      'ratelimit-remaining': String(Math.max(0, rule.limit - count)),
      'ratelimit-reset': String(resetSeconds),
    };
    if (count > rule.limit) throw new RateLimitedError(resetSeconds, headers);
    await next();
    for (const [name, value] of Object.entries(headers)) c.header(name, value);
  };
}
