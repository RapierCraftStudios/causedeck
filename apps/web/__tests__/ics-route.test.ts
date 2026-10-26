// `GET /api/ics/[token]` (#53): the route only maps `serveFeed` results to responses. 200 is
// `text/calendar; charset=utf-8` with an ETag and `Cache-Control: private`, 304 echoes the ETag, 404
// is bodyless and never cached, 429 says when to retry, and the flag gate is passed to the domain as
// `enabled`. Only GET is exported, so the feed has no write path. `serveFeed` itself is covered on
// the database in packages/core/src/calendar/__tests__/calendar.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const hoisted: {
    result: Record<string, unknown>;
    serve: ReturnType<typeof vi.fn>;
    isEnabled: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  } = { result: { status: 404 }, serve: vi.fn(), isEnabled: vi.fn(), limit: vi.fn() };
  return hoisted;
});

vi.mock('@causedeck/core/calendar', () => ({
  serveFeed: (deps: unknown, request: unknown) => {
    state.serve(deps, request);
    return Promise.resolve(state.result);
  },
}));
vi.mock('@causedeck/core/runtime', () => ({
  db: { marker: 'db' },
  consumeRequestLimit: state.limit,
}));
vi.mock('@causedeck/flags/server', () => ({
  isFlagOffError: (error: unknown) => error instanceof Error && error.name === 'FlagOffError',
  requireFlag: state.isEnabled,
}));
vi.mock('../lib/env.ts', () => ({ serverEnv: () => ({ APP_URL: 'https://app.causedeck.test' }) }));

const route = await import('../app/api/ics/[token]/route.ts');

const TOKEN = 'A'.repeat(43);
const call = (headers: Record<string, string> = {}) =>
  route.GET(new Request(`https://app.causedeck.test/api/ics/${TOKEN}`, { headers }), {
    params: Promise.resolve({ token: TOKEN }),
  });

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/ics/[token]', () => {
  it('serves the calendar with an ETag and a private cache header', async () => {
    state.result = { status: 200, etag: '"abc"', body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' };
    const response = await call({ 'if-none-match': '"old"' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('etag')).toBe('"abc"');
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toContain('BEGIN:VCALENDAR');
    expect(state.serve).toHaveBeenCalledWith(
      expect.objectContaining({ appUrl: 'https://app.causedeck.test' }),
      { token: TOKEN, ifNoneMatch: '"old"' },
    );
  });

  it('answers 304 with the ETag and no body', async () => {
    state.result = { status: 304, etag: '"abc"' };
    const response = await call({ 'if-none-match': '"abc"' });
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('"abc"');
    expect(await response.text()).toBe('');
  });

  it('answers a bodyless, uncached 404', async () => {
    state.result = { status: 404 };
    const response = await call();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('answers 429 with Retry-After', async () => {
    state.result = { status: 429, retryAfterSec: 3600 };
    const response = await call();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3600');
  });

  it('hands the domain the rate limiter and a flag check that treats a dark flag as off', async () => {
    state.result = { status: 404 };
    await call();
    const deps = state.serve.mock.calls[0]?.[0] as {
      limit: unknown;
      enabled: (scope: { workspaceId: string; userId: string }) => Promise<boolean>;
    };
    expect(deps.limit).toBe(state.limit);
    state.isEnabled.mockResolvedValueOnce(undefined);
    expect(await deps.enabled({ workspaceId: 'w', userId: 'u' })).toBe(true);
    expect(state.isEnabled).toHaveBeenCalledWith('capture.ics-feed', {
      workspaceId: 'w',
      userId: 'u',
    });
    state.isEnabled.mockRejectedValueOnce(
      Object.assign(new Error('off'), { name: 'FlagOffError' }),
    );
    expect(await deps.enabled({ workspaceId: 'w', userId: 'u' })).toBe(false);
  });

  it('exports GET only: no write-back, invitation or message path', () => {
    const exported = Object.keys(route).filter((name) =>
      /^(GET|POST|PUT|PATCH|DELETE)$/.test(name),
    );
    expect(exported).toEqual(['GET']);
  });
});
