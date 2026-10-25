// `/api/push/{subscribe,unsubscribe}` (#197): signed-in only, same-origin only, disabled (503)
// without VAPID keys, and they store or revoke the caller's own subscription.
import { NotificationError } from '@causedeck/notifications';
import type * as Push from '@causedeck/notifications/push';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface State {
  session: { user: { id: string } } | null;
  env: { APP_URL: string; VAPID_PUBLIC_KEY?: string | undefined };
  save: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
}

const state: State = vi.hoisted(() => ({
  session: { user: { id: '00000000-0000-4000-8000-000000000001' } },
  env: { APP_URL: 'https://app.causedeck.test', VAPID_PUBLIC_KEY: 'pub' },
  save: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('@causedeck/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: { marker: 'db' },
}));
vi.mock('../../../../lib/auth.ts', () => ({ getSession: () => Promise.resolve(state.session) }));
vi.mock('../../../../lib/env.ts', () => ({ serverEnv: () => state.env }));
vi.mock('@causedeck/notifications/push', async (importOriginal) => {
  const actual = await importOriginal<typeof Push>();
  return {
    ...actual,
    pushConfig: (env: { VAPID_PUBLIC_KEY?: string }) =>
      env.VAPID_PUBLIC_KEY === undefined ? null : { publicKey: env.VAPID_PUBLIC_KEY },
    saveSubscription: state.save,
    revokeSubscription: state.revoke,
  };
});

const subscribe = await import('../subscribe/route.ts');
const unsubscribe = await import('../unsubscribe/route.ts');

const SUB = {
  endpoint: 'https://push.example.test/send/abc',
  keys: { p256dh: 'p', auth: 'a' },
};

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://app.causedeck.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  state.session = { user: { id: '00000000-0000-4000-8000-000000000001' } };
  state.env.VAPID_PUBLIC_KEY = 'pub';
  state.save.mockReset();
  state.revoke.mockReset();
});

describe('POST /api/push/subscribe', () => {
  it('stores the caller subscription with the user agent', async () => {
    state.save.mockResolvedValue({ id: 'sub-1' });
    const res = await subscribe.POST(
      post('/api/push/subscribe', SUB, {
        'user-agent': 'UA/1',
        origin: 'https://app.causedeck.test',
      }),
    );
    expect(res.status).toBe(201);
    expect(state.save).toHaveBeenCalledWith(
      { marker: 'db' },
      '00000000-0000-4000-8000-000000000001',
      SUB,
      'UA/1',
    );
  });

  it('rejects signed-out callers, other origins and malformed bodies', async () => {
    state.session = null;
    expect((await subscribe.POST(post('/api/push/subscribe', SUB))).status).toBe(401);
    state.session = { user: { id: '00000000-0000-4000-8000-000000000001' } };
    const foreign = post('/api/push/subscribe', SUB, { origin: 'https://evil.example' });
    expect((await subscribe.POST(foreign)).status).toBe(403);
    expect((await subscribe.POST(post('/api/push/subscribe', '{not json'))).status).toBe(400);
    state.save.mockRejectedValue(new NotificationError('VALIDATION', 'invalid push subscription'));
    expect((await subscribe.POST(post('/api/push/subscribe', {}))).status).toBe(400);
  });

  it('is 503 when push is disabled (no VAPID keys)', async () => {
    state.env.VAPID_PUBLIC_KEY = undefined;
    const res = await subscribe.POST(post('/api/push/subscribe', SUB));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'push_disabled' });
    expect(state.save).not.toHaveBeenCalled();
  });
});

describe('POST /api/push/unsubscribe', () => {
  it('revokes only for the caller', async () => {
    state.revoke.mockResolvedValue(true);
    const res = await unsubscribe.POST(post('/api/push/unsubscribe', { endpoint: SUB.endpoint }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: true });
    expect(state.revoke).toHaveBeenCalledWith(
      { marker: 'db' },
      '00000000-0000-4000-8000-000000000001',
      SUB.endpoint,
    );
  });

  it('rejects signed-out callers, other origins and a missing endpoint', async () => {
    state.session = null;
    expect((await unsubscribe.POST(post('/api/push/unsubscribe', SUB))).status).toBe(401);
    state.session = { user: { id: '00000000-0000-4000-8000-000000000001' } };
    const foreign = post('/api/push/unsubscribe', SUB, { origin: 'https://evil.example' });
    expect((await unsubscribe.POST(foreign)).status).toBe(403);
    expect((await unsubscribe.POST(post('/api/push/unsubscribe', {}))).status).toBe(400);
    expect(state.revoke).not.toHaveBeenCalled();
  });
});
