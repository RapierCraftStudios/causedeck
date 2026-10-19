// `POST /api/uploads` (#217): same-origin, signed-in, member-only (non-members get 404, like
// another workspace's blob), rate limited per user, and `assertCan` gates each action
// (`document.write` for intent and finalize, `document.read` for download).
import type * as Storage from '@causedeck/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = '00000000-0000-4000-8000-0000000000a1';
const OTHER_WS = '00000000-0000-4000-8000-0000000000b1';
const USER = '00000000-0000-4000-8000-000000000001';
const BLOB = '00000000-0000-4000-8000-0000000000c1';

interface State {
  session: { user: { id: string } } | null;
  role: string | null;
  withinLimit: boolean;
  intent: ReturnType<typeof vi.fn>;
  finalize: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  memberRole: ReturnType<typeof vi.fn>;
  rateLimit: ReturnType<typeof vi.fn>;
}

const state: State = vi.hoisted(() => ({
  session: { user: { id: '00000000-0000-4000-8000-000000000001' } },
  role: 'owner',
  withinLimit: true,
  intent: vi.fn(),
  finalize: vi.fn(),
  download: vi.fn(),
  memberRole: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@causedeck/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: { marker: 'db' },
}));
vi.mock('../../../../lib/auth.ts', () => ({ getSession: () => Promise.resolve(state.session) }));
vi.mock('../../../../lib/env.ts', () => ({
  serverEnv: () => ({ APP_URL: 'https://app.causedeck.test' }),
}));
vi.mock('../../../../lib/storage.ts', () => ({ objectStore: () => ({ marker: 'store' }) }));
vi.mock('@causedeck/core/workspaces', () => ({ memberRole: state.memberRole }));
vi.mock('@causedeck/auth/rate-limit', () => ({ consumeRateLimit: state.rateLimit }));
vi.mock('@causedeck/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof Storage>()),
  createUploadIntent: state.intent,
  finalizeUpload: state.finalize,
  createDownloadUrl: state.download,
}));

const { UploadError } = await import('@causedeck/storage');
const route = await import('../route.ts');

const INTENT = {
  action: 'intent',
  workspaceId: WS,
  kind: 'document',
  filename: 'order.pdf',
  size: 1234,
  mime: 'application/pdf',
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://app.causedeck.test/api/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** The services run the route's `authorize` seam first, as the real ones do. */
function authorizing(action: Storage.StorageAction, result: unknown) {
  return async (ctx: Storage.StorageCtx) => {
    await ctx.authorize(action);
    return result;
  };
}

afterEach(() => {
  state.session = { user: { id: USER } };
  state.role = 'owner';
  state.withinLimit = true;
  for (const fn of [state.intent, state.finalize, state.download]) fn.mockReset();
});

state.memberRole.mockImplementation((_db: unknown, _user: string, workspaceId: string) =>
  Promise.resolve(workspaceId === WS ? state.role : null),
);
state.rateLimit.mockImplementation(() => Promise.resolve(state.withinLimit));

describe('POST /api/uploads', () => {
  it('creates an intent for a member with document.write, scoped to the checked workspace', async () => {
    const upload = { url: 'memory://x', method: 'PUT', headers: {}, expiresAt: new Date(0) };
    state.intent.mockImplementation(
      authorizing('document.write', { blobId: BLOB, key: 'k', upload }),
    );
    const res = await route.POST(post(INTENT, { origin: 'https://app.causedeck.test' }));
    expect(res.status).toBe(201);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.json()).toEqual({
      blobId: BLOB,
      upload: { ...upload, expiresAt: new Date(0).toISOString() },
    });
    const [ctx, input] = state.intent.mock.calls[0] as [Storage.StorageCtx, unknown];
    expect(ctx).toMatchObject({
      db: { marker: 'db' },
      store: { marker: 'store' },
      workspaceId: WS,
      userId: USER,
    });
    expect(input).toMatchObject({ kind: 'document', filename: 'order.pdf', size: 1234 });
    expect(state.rateLimit).toHaveBeenCalledWith(
      { marker: 'db' },
      `uploads:${USER}`,
      route.UPLOAD_RATE_LIMIT,
    );
  });

  it('finalizes and issues download URLs', async () => {
    state.finalize.mockImplementation(
      authorizing('document.write', { blobId: BLOB, scanStatus: 'pending' }),
    );
    const fin = await route.POST(post({ action: 'finalize', workspaceId: WS, blobId: BLOB }));
    expect(fin.status).toBe(200);
    expect(await fin.json()).toEqual({ blobId: BLOB, scanStatus: 'pending' });
    expect(state.finalize.mock.calls[0]?.[1]).toBe(BLOB);

    state.role = 'viewer';
    state.download.mockImplementation(
      authorizing('document.read', {
        url: 'memory://get',
        expiresAt: new Date(60_000),
        headers: {},
      }),
    );
    const res = await route.POST(post({ action: 'download', workspaceId: WS, blobId: BLOB }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: 'memory://get',
      expiresAt: new Date(60_000).toISOString(),
    });
  });

  it('is 403 when the role may not write (assertCan document.write)', async () => {
    state.role = 'viewer';
    state.intent.mockImplementation(authorizing('document.write', {}));
    state.finalize.mockImplementation(authorizing('document.write', {}));
    expect((await route.POST(post(INTENT))).status).toBe(403);
    expect(
      (await route.POST(post({ action: 'finalize', workspaceId: WS, blobId: BLOB }))).status,
    ).toBe(403);
  });

  it('is 404 for a workspace the caller is not a member of, before any storage call', async () => {
    for (const body of [
      { ...INTENT, workspaceId: OTHER_WS },
      { action: 'finalize', workspaceId: OTHER_WS, blobId: BLOB },
      { action: 'download', workspaceId: OTHER_WS, blobId: BLOB },
    ]) {
      const res = await route.POST(post(body));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect(state.intent).not.toHaveBeenCalled();
    expect(state.finalize).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });

  it("maps another workspace's blob (NOT_FOUND), bad files and size caps", async () => {
    state.download.mockRejectedValue(new UploadError('NOT_FOUND', 'not found'));
    expect(
      (await route.POST(post({ action: 'download', workspaceId: WS, blobId: BLOB }))).status,
    ).toBe(404);
    state.finalize.mockRejectedValue(new UploadError('VALIDATION', 'file content does not match'));
    expect(
      (await route.POST(post({ action: 'finalize', workspaceId: WS, blobId: BLOB }))).status,
    ).toBe(400);
    state.intent.mockRejectedValue(new UploadError('TOO_LARGE', 'too large'));
    const big = await route.POST(post(INTENT));
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'too_large', message: 'too large' });
  });

  it('rejects other origins, signed-out callers, bad bodies and callers over the rate limit', async () => {
    expect((await route.POST(post(INTENT, { origin: 'https://evil.example' }))).status).toBe(403);
    state.session = null;
    expect((await route.POST(post(INTENT))).status).toBe(401);
    state.session = { user: { id: USER } };
    expect((await route.POST(post('{nope'))).status).toBe(400);
    expect((await route.POST(post({ ...INTENT, kind: 'executable' }))).status).toBe(400);
    expect(
      (
        await route.POST(
          post({ action: 'download', workspaceId: WS, blobId: 'ws/x/document/2026/y' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await route.POST(post({ action: 'delete', workspaceId: WS, blobId: BLOB }))).status,
    ).toBe(400);
    state.withinLimit = false;
    expect((await route.POST(post(INTENT))).status).toBe(429);
    expect(state.intent).not.toHaveBeenCalled();
  });
});
