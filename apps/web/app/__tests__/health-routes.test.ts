import { afterEach, describe, expect, it, vi } from 'vitest';

import { health, logger } from '../../src/health.ts';
import { GET as healthz } from '../healthz/route.ts';
import { GET as readyz } from '../readyz/route.ts';

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, { headers });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apps/web health routes', () => {
  it('GET /healthz returns 200 {status: ok}', async () => {
    const res = await healthz(get('/healthz'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /readyz returns 200 with no checks registered and echoes x-request-id', async () => {
    const res = await readyz(get('/readyz', { 'x-request-id': 'probe-7' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', checks: {} });
    expect(res.headers.get('x-request-id')).toBe('probe-7');
  });

  it('GET /readyz returns 503 when a registered check fails', async () => {
    health.registerCheck('always-down', () => Promise.reject(new Error('down')));
    try {
      const res = await readyz(get('/readyz'));

      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ checks: { 'always-down': { ok: false } } });
    } finally {
      health.registerCheck('always-down', () => Promise.resolve());
    }
  });

  it('logs health probes at debug, not info', async () => {
    const debug = vi.spyOn(logger, 'debug');
    const info = vi.spyOn(logger, 'info');

    await healthz(get('/healthz'));
    await readyz(get('/readyz'));

    expect(debug).toHaveBeenCalledTimes(2);
    expect(debug.mock.calls[0]?.[0]).toMatchObject({ path: '/healthz', status: 200 });
    expect(info).not.toHaveBeenCalled();
  });

  it('instrumentation register() is silent without a DSN or OTLP endpoint', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const { register } = await import('../../instrumentation.ts');

    await expect(register()).resolves.toBeUndefined();

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
