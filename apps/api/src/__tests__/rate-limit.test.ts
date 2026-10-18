// Rate limiting: per user, per IP when anonymous, RateLimit-* headers, 429 problem, per-group rules.
import { closeTestDb } from '@causedeck/db/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { DEFAULT_RATE_LIMIT, MemoryRateLimitStore } from '../middleware/rate-limit.ts';

import { call, makeApp, problemOf, signIn, uniqueIp } from './helpers.ts';

afterAll(closeTestDb);

describe('rate limiting', () => {
  it('defaults to 120 requests per minute', () => {
    expect(DEFAULT_RATE_LIMIT).toEqual({ limit: 120, windowMs: 60_000 });
  });

  it('allows the default 120/min per user, then answers 429 with RateLimit-* headers', async () => {
    const user = await signIn();
    const at = 1_800_000_000_000;
    const app = makeApp({ now: () => new Date(at) });

    for (let i = 1; i <= 120; i += 1) {
      // A different IP each time: the limit follows the user, not the address.
      const response = await call(app, '/v1/me', { cookie: user.cookie, ip: uniqueIp() });
      expect(response.status).toBe(200);
      if (i === 1) {
        expect(response.headers.get('ratelimit-limit')).toBe('120');
        expect(response.headers.get('ratelimit-remaining')).toBe('119');
        expect(response.headers.get('ratelimit-reset')).toBe('60');
      }
    }
    const limited = await call(app, '/v1/me', { cookie: user.cookie });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('ratelimit-remaining')).toBe('0');
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await problemOf(limited)).code).toBe('RATE_LIMITED');

    // Another user is unaffected.
    const other = await signIn();
    expect((await call(app, '/v1/me', { cookie: other.cookie })).status).toBe(200);
  });

  it('limits anonymous callers per IP and resets after the window', async () => {
    let at = 1_800_000_000_000;
    const app = makeApp({
      now: () => new Date(at),
      rateLimit: { default: { limit: 2, windowMs: 60_000 } },
    });
    const ip = uniqueIp();
    expect((await call(app, '/v1/me', { ip })).status).toBe(401);
    expect((await call(app, '/v1/me', { ip })).status).toBe(401);
    expect((await call(app, '/v1/me', { ip })).status).toBe(429);
    expect((await call(app, '/v1/me', { ip: uniqueIp() })).status).toBe(401);

    at += 60_000;
    expect((await call(app, '/v1/me', { ip })).status).toBe(401);
  });

  it('applies per-group rules with their own counters', async () => {
    const user = await signIn();
    const store = new MemoryRateLimitStore();
    const app = makeApp({
      rateLimit: {
        store,
        default: { limit: 100, windowMs: 60_000 },
        groups: { '/v1/workspaces': { limit: 1, windowMs: 60_000 } },
      },
    });
    const first = await call(app, '/v1/workspaces', { cookie: user.cookie });
    expect(first.status).toBe(200);
    expect(first.headers.get('ratelimit-limit')).toBe('1');
    expect((await call(app, '/v1/workspaces', { cookie: user.cookie })).status).toBe(429);
    const me = await call(app, '/v1/me', { cookie: user.cookie });
    expect(me.status).toBe(200);
    expect(me.headers.get('ratelimit-limit')).toBe('100');
  });

  it('does not count health probes', async () => {
    const app = makeApp({ rateLimit: { default: { limit: 1, windowMs: 60_000 } } });
    const ip = uniqueIp();
    for (let i = 0; i < 3; i += 1) expect((await call(app, '/healthz', { ip })).status).toBe(200);
  });
});
