// `/api/exports/[id]/download` (#301): POST checks same-origin, session and membership, then core
// issues the requester-only link; GET checks the signed token against the URL and the session
// user, core re-checks owner, requester, expiry and the current nonce (audited), and the decrypted
// ZIP streams as a no-store attachment, pulled chunk by chunk. Core services are mocked here; their
// own tests cover the checks behind them (packages/core/src/lifecycle/__tests__).
import { WorkspaceError } from '@causedeck/core/workspaces';
import { afterEach, describe, expect, it, vi } from 'vitest';

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const WS = '00000000-0000-4000-8000-00000000000a';
const JOB = '00000000-0000-4000-8000-0000000000e1';

interface State {
  session: { user: { id: string } } | null;
  role: string | null;
  issue: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
}

const state: State = vi.hoisted(() => ({
  session: { user: { id: '00000000-0000-4000-8000-000000000001' } },
  role: 'owner',
  issue: vi.fn(),
  open: vi.fn(),
  read: vi.fn(),
}));

vi.mock('@causedeck/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: { marker: 'db' },
}));
vi.mock('../../../../lib/auth.ts', () => ({ getSession: () => Promise.resolve(state.session) }));
vi.mock('../../../../lib/env.ts', () => ({
  serverEnv: () => ({
    APP_URL: 'https://app.causedeck.test',
    BETTER_AUTH_SECRET: { reveal: () => 's'.repeat(40) },
  }),
}));
vi.mock('../../../../lib/storage.ts', () => ({ objectStore: () => ({ marker: 'store' }) }));
vi.mock('@causedeck/storage', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EnvKeyProvider: { fromEnv: () => ({ marker: 'keys' }) },
}));
vi.mock('@causedeck/core/workspaces', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  memberRole: () => Promise.resolve(state.role),
}));
vi.mock('@causedeck/core/lifecycle', () => ({
  issueExportDownload: state.issue,
  openExportDownload: state.open,
  readExportToken: state.read,
}));

const route = await import('../[id]/download/route.ts');

const params = (id = JOB) => ({ params: Promise.resolve({ id }) });

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://app.causedeck.test/api/exports/${JOB}/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const get = (token = 'tok.mac') =>
  new Request(
    `https://app.causedeck.test/api/exports/${JOB}/download?token=${encodeURIComponent(token)}`,
  );

const payload = (over: Partial<Record<string, unknown>> = {}) => ({
  j: JOB,
  w: WS,
  u: USER,
  exp: Date.now() + 1000,
  n: 'n'.repeat(43),
  ...over,
});

afterEach(() => {
  state.session = { user: { id: USER } };
  state.role = 'owner';
  state.issue.mockReset();
  state.open.mockReset();
  state.read.mockReset();
});

describe('POST /api/exports/[id]/download', () => {
  it('issues a requester-only link through core and never caches it', async () => {
    const expiresAt = new Date('2026-10-21T00:00:00Z');
    state.issue.mockResolvedValue({ token: 'abc.def', expiresAt });
    const res = await route.POST(post({ workspaceId: WS }), params());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      url: `/api/exports/${JOB}/download?token=abc.def`,
      expiresAt: expiresAt.toISOString(),
    });
    expect(state.issue).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, userId: USER }),
      JOB,
      { secret: 's'.repeat(40) },
    );
  });

  it('refuses signed-out, cross-origin, bad input and non-members', async () => {
    expect(
      (await route.POST(post({ workspaceId: WS }, { origin: 'https://evil.test' }), params()))
        .status,
    ).toBe(403);
    expect((await route.POST(post('{'), params())).status).toBe(400);
    expect((await route.POST(post({ workspaceId: 'x' }), params())).status).toBe(400);
    expect((await route.POST(post({ workspaceId: WS }), params('nope'))).status).toBe(404);
    state.role = null;
    expect((await route.POST(post({ workspaceId: WS }), params())).status).toBe(403);
    state.session = null;
    expect((await route.POST(post({ workspaceId: WS }), params())).status).toBe(401);
    expect(state.issue).not.toHaveBeenCalled();
  });

  it("maps core's denials: not the requester or not ready is 404, not an owner is 403", async () => {
    state.issue.mockRejectedValueOnce(new WorkspaceError('NOT_FOUND', 'Export not found'));
    expect((await route.POST(post({ workspaceId: WS }), params())).status).toBe(404);
    state.issue.mockRejectedValueOnce(new WorkspaceError('FORBIDDEN', 'owners only'));
    expect((await route.POST(post({ workspaceId: WS }), params())).status).toBe(403);
  });
});

describe('GET /api/exports/[id]/download', () => {
  it('streams the decrypted ZIP as a no-store attachment, pulling chunk by chunk', async () => {
    state.read.mockReturnValue(payload());
    let pulled = 0;
    async function* body() {
      for (const part of ['PK', 'zip', 'end']) {
        pulled += 1;
        yield await Promise.resolve(new TextEncoder().encode(part));
      }
    }
    state.open.mockResolvedValue({
      filename: `causedeck-export-${JOB}.zip`,
      sizeBytes: 8,
      sha256: 'a'.repeat(64),
      body: body(),
    });
    const res = await route.GET(get(), params());
    expect(res.status).toBe(200);
    expect(pulled).toBeLessThanOrEqual(1);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toContain('attachment;');
    expect(await res.text()).toBe('PKzipend');
    expect(state.open).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, userId: USER }),
      JOB,
      'tok.mac',
      { store: { marker: 'store' }, keys: { marker: 'keys' }, secret: 's'.repeat(40) },
    );
  });

  it('is 404 for a bad token, another export, another user or an expired export', async () => {
    state.read.mockReturnValueOnce(null);
    expect((await route.GET(get(), params())).status).toBe(404);
    state.read.mockReturnValueOnce(payload({ j: '00000000-0000-4000-8000-0000000000e2' }));
    expect((await route.GET(get(), params())).status).toBe(404);
    state.read.mockReturnValueOnce(payload({ u: OTHER }));
    expect((await route.GET(get(), params())).status).toBe(404);
    expect(state.open).not.toHaveBeenCalled();
    state.read.mockReturnValueOnce(payload());
    state.open.mockRejectedValueOnce(new WorkspaceError('NOT_FOUND', 'Export not found'));
    expect((await route.GET(get(), params())).status).toBe(404);
  });

  it('is 401 signed out and 403 for a workspace the user left', async () => {
    state.read.mockReturnValue(payload());
    state.role = null;
    expect((await route.GET(get(), params())).status).toBe(403);
    state.session = null;
    expect((await route.GET(get(), params())).status).toBe(401);
    expect(state.open).not.toHaveBeenCalled();
  });
});
