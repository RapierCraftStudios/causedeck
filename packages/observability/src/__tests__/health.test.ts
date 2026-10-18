import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHealthHandlers, isHealthPath } from '../health.ts';

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
