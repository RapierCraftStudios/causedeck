import { describe, expect, it, vi } from 'vitest';

import { getRequestContext } from '../context.ts';
import { honoRequestLogger, withRequestLogging, type HonoLikeContext } from '../http.ts';
import { captureLogger } from './helpers.ts';

describe('withRequestLogging', () => {
  it('logs one line with method, path, status, duration and requestId, and echoes the id', async () => {
    const { logger, lines, raw } = captureLogger();
    let seen: string | undefined;
    const handler = withRequestLogging(logger, () => {
      seen = getRequestContext()?.requestId;
      return Promise.resolve(new Response('ok', { status: 201 }));
    });

    const res = await handler(
      new Request('http://localhost/matters/42?token=secret-query', {
        method: 'POST',
        headers: { 'x-request-id': 'rid-1' },
      }),
    );

    expect(res.headers.get('x-request-id')).toBe('rid-1');
    expect(seen).toBe('rid-1');
    const [line] = lines();
    expect(line).toMatchObject({
      level: 'info',
      method: 'POST',
      path: '/matters/42',
      status: 201,
      requestId: 'rid-1',
    });
    expect(typeof line?.durationMs).toBe('number');
    expect(raw()).not.toContain('secret-query');
  });

  it('uses the route template when given', async () => {
    const { logger, lines } = captureLogger();
    const handler = withRequestLogging(logger, () => Promise.resolve(new Response('ok')), {
      route: '/matters/:id',
    });

    await handler(new Request('http://localhost/matters/42'));

    expect(lines()[0]?.path).toBe('/matters/:id');
  });

  it('logs health probes at debug', async () => {
    const { logger, lines } = captureLogger();
    const handler = withRequestLogging(logger, () => Promise.resolve(new Response('ok')));

    await handler(new Request('http://localhost/healthz'));
    await handler(new Request('http://localhost/readyz'));

    expect(lines().map((l) => l.level)).toEqual(['debug', 'debug']);
  });

  it('mints an id when none is sent and copies immutable responses', async () => {
    const { logger } = captureLogger();
    const immutable = Response.redirect('http://localhost/elsewhere', 302);
    const handler = withRequestLogging(logger, () => Promise.resolve(immutable));

    const res = await handler(new Request('http://localhost/x'));

    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs failures at error with status 500 and rethrows', async () => {
    const { logger, lines } = captureLogger();
    const handler = withRequestLogging(logger, () => Promise.reject(new Error('kaboom')));

    await expect(handler(new Request('http://localhost/x'))).rejects.toThrow('kaboom');

    expect(lines()[0]).toMatchObject({ level: 'error', status: 500 });
  });
});

describe('honoRequestLogger', () => {
  it('logs and sets x-request-id on the Hono response', async () => {
    const { logger, lines } = captureLogger();
    const header = vi.fn();
    const ctx: HonoLikeContext = {
      req: { raw: new Request('http://localhost/v1/ping', { headers: { 'x-request-id': 'h-1' } }) },
      res: new Response(null, { status: 204 }),
      header,
    };

    await honoRequestLogger(logger)(ctx, () => Promise.resolve());

    expect(header).toHaveBeenCalledWith('x-request-id', 'h-1');
    expect(lines()[0]).toMatchObject({ path: '/v1/ping', status: 204, requestId: 'h-1' });
  });
});
