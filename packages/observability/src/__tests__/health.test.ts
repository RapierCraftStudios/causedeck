import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clockDriftCheckFromEnv,
  createClockDriftCheck,
  createHealthHandlers,
  httpDateReference,
  isHealthPath,
} from '../health.ts';

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { headers });

afterEach(() => {
  vi.useRealTimers();
});

describe('health handlers', () => {
  it('healthz returns 200 without touching dependencies', async () => {
    const check = vi.fn(() => Promise.resolve());
    const { healthz } = createHealthHandlers({ checks: { db: check }, version: 'v1' });

    const res = await healthz(get('/healthz'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', version: 'v1' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(check).not.toHaveBeenCalled();
  });

  it('readyz returns 200 when every check passes', async () => {
    const { readyz, registerCheck } = createHealthHandlers({ version: 'v1' });
    registerCheck('db', () => Promise.resolve());
    registerCheck('storage', () => Promise.resolve());

    const res = await readyz(get('/readyz'));
    const body = (await res.json()) as { status: string; checks: Record<string, { ok: boolean }> };

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.checks.db?.ok).toBe(true);
    expect(body.checks.storage?.ok).toBe(true);
  });

  it('readyz returns 503 with per-check booleans and no error details', async () => {
    const { readyz } = createHealthHandlers({
      checks: {
        db: () => Promise.reject(new Error('connect ECONNREFUSED password=hunter2')),
        storage: () => Promise.resolve(),
        sync: () => {
          throw new Error('sync throw');
        },
      },
    });

    const res = await readyz(get('/readyz'));
    const text = await res.text();
    const body = JSON.parse(text) as { status: string; checks: Record<string, { ok: boolean }> };

    expect(res.status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.checks).toMatchObject({
      db: { ok: false },
      storage: { ok: true },
      sync: { ok: false },
    });
    expect(text).not.toContain('ECONNREFUSED');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('sync throw');
  });

  it('bounds each check by a 2 s timeout', async () => {
    vi.useFakeTimers();
    const { readyz } = createHealthHandlers({
      checks: { slow: () => new Promise(() => undefined), fast: () => Promise.resolve() },
    });

    const pending = readyz(get('/readyz'));
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ checks: { slow: { ok: false }, fast: { ok: true } } });
  });

  it('echoes x-request-id', async () => {
    const { healthz } = createHealthHandlers();

    const res = await healthz(get('/healthz', { 'x-request-id': 'probe-1' }));

    expect(res.headers.get('x-request-id')).toBe('probe-1');
  });

  it('recognises health paths', () => {
    expect(isHealthPath('/healthz')).toBe(true);
    expect(isHealthPath('/readyz/')).toBe(true);
    expect(isHealthPath('/healthzx')).toBe(false);
    expect(isHealthPath('/api/healthz')).toBe(false);
  });
});

describe('clock drift check', () => {
  const at = (now: number, reference: number) =>
    createClockDriftCheck({ now: () => now, reference: () => Promise.resolve(reference) });

  it('passes within 1 s and tolerates whole-second truncation of the reference', async () => {
    await expect(at(10_000, 10_000)()).resolves.toBeUndefined();
    await expect(at(10_900, 10_000)()).resolves.toBeUndefined();
    await expect(at(10_000, 10_800)()).resolves.toBeUndefined();
  });

  it('fails when the clock is more than 1 s ahead or behind', async () => {
    await expect(at(12_500, 10_000)()).rejects.toThrow(/clock drift/);
    await expect(at(10_000, 11_500)()).rejects.toThrow(/clock drift/);
  });

  it('fails readiness (503) when drifted, without leaking details', async () => {
    const { readyz, registerCheck } = createHealthHandlers({ version: 'v1' });
    registerCheck('clock', at(20_000, 10_000));
    const res = await readyz(get('/readyz'));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/drift/);
  });

  it('reads the reference from an HTTP Date header and fails without one', async () => {
    const ok = vi.fn(() =>
      Promise.resolve(new Response(null, { headers: { date: 'Wed, 01 Jan 2025 00:00:00 GMT' } })),
    ) as unknown as typeof fetch;
    await expect(httpDateReference('https://ref.test', ok)()).resolves.toBe(
      Date.parse('2025-01-01T00:00:00Z'),
    );
    const bad = vi.fn(() => Promise.resolve(new Response(null))) as unknown as typeof fetch;
    await expect(httpDateReference('https://ref.test', bad)()).rejects.toThrow(/Date/);
  });

  it('is only enabled when CLOCK_DRIFT_REFERENCE_URL is set', () => {
    expect(clockDriftCheckFromEnv({})).toBeUndefined();
    expect(clockDriftCheckFromEnv({ CLOCK_DRIFT_REFERENCE_URL: '' })).toBeUndefined();
    expect(clockDriftCheckFromEnv({ CLOCK_DRIFT_REFERENCE_URL: 'https://ref.test' })).toBeTypeOf(
      'function',
    );
  });
});
