// `/api/audit/export` (#229): POST checks session, same-origin, membership and core `audit.read`
// (advocate setting included) and returns a 60 s signed link; GET verifies the token against the
// session user, re-checks via `exportAudit` and streams it as an attachment without buffering.
import { WorkspaceError } from '@causedeck/core/workspaces';
import { afterEach, describe, expect, it, vi } from 'vitest';

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const WS = '00000000-0000-4000-8000-00000000000a';

interface State {
  session: { user: { id: string } } | null;
  role: string | null;
  authorize: ReturnType<typeof vi.fn>;
  exportAudit: ReturnType<typeof vi.fn>;
}

const state: State = vi.hoisted(() => ({
  session: { user: { id: '00000000-0000-4000-8000-000000000001' } },
  role: 'owner',
  authorize: vi.fn(),
  exportAudit: vi.fn(),
}));

vi.mock('@causedeck/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: { marker: 'db' },
}));
vi.mock('../../../../lib/auth.ts', () => ({ getSession: () => Promise.resolve(state.session) }));
vi.mock('../../../../lib/env.ts', () => ({
  serverEnv: () => ({
    APP_URL: 'https://app.causedeck.test',
    BETTER_AUTH_SECRET: { reveal: () => 'x'.repeat(40) },
  }),
}));
vi.mock('@causedeck/core/workspaces', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  memberRole: () => Promise.resolve(state.role),
}));
vi.mock('@causedeck/core/audit', () => ({
  authorizeAuditRead: state.authorize,
  exportAudit: state.exportAudit,
}));

const route = await import('../export/route.ts');

const BODY = {
  workspaceId: WS,
  from: '2026-01-01T00:00:00Z',
  to: '2026-02-01T00:00:00Z',
  format: 'csv',
  bom: true,
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://app.causedeck.test/api/audit/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function get(url: string, headers: Record<string, string> = {}) {
  return new Request(new URL(url, 'https://app.causedeck.test'), { headers });
}

async function link(body: object = BODY): Promise<string> {
  const res = await route.POST(post(body));
  expect(res.status).toBe(200);
  return ((await res.json()) as { url: string }).url;
}

/** A stream that counts how many chunks the consumer has pulled. */
function counted(chunks: string[]) {
  const pulls = { n: 0 };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const next = chunks[pulls.n++];
        if (next === undefined) controller.close();
        else controller.enqueue(encoder.encode(next));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulls };
}

afterEach(() => {
  vi.useRealTimers();
  state.session = { user: { id: USER } };
  state.role = 'owner';
  state.authorize.mockReset();
  state.exportAudit.mockReset();
});

describe('POST /api/audit/export', () => {
  it('returns a short-lived signed link after the core audit.read check', async () => {
    state.authorize.mockResolvedValue('owner');
    const before = Date.now();
    const res = await route.POST(post(BODY, { origin: 'https://app.causedeck.test' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { url, expiresAt } = (await res.json()) as { url: string; expiresAt: string };
    expect(url).toMatch(/^\/api\/audit\/export\?token=[\w.%-]+$/);
    const ttl = Date.parse(expiresAt) - before;
    expect(ttl).toBeGreaterThan(55_000);
    expect(ttl).toBeLessThanOrEqual(61_000);
    expect(state.authorize).toHaveBeenCalledWith({ db: { marker: 'db' }, workspaceId: WS, userId: USER });
  });

  it('rejects signed-out callers, other origins, bad bodies and non-members', async () => {
    state.session = null;
    expect((await route.POST(post(BODY))).status).toBe(401);
    state.session = { user: { id: USER } };
    expect((await route.POST(post(BODY, { origin: 'https://evil.example' }))).status).toBe(403);
    for (const bad of ['{nope', {}, { ...BODY, workspaceId: 'x' }, { ...BODY, format: 'xlsx' }, { ...BODY, to: BODY.from }]) {
      const res = await route.POST(post(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid' });
    }
    state.role = null;
    expect((await route.POST(post(BODY))).status).toBe(403);
    expect(state.authorize).not.toHaveBeenCalled();
  });

  it('maps the core gate: clerks/juniors/viewers and switched-off advocates are 403', async () => {
    for (const role of ['clerk', 'junior', 'viewer', 'advocate']) {
      state.role = role;
      state.authorize.mockRejectedValueOnce(new WorkspaceError('FORBIDDEN', 'no'));
      const res = await route.POST(post(BODY));
      expect(res.status, role).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
    state.authorize.mockRejectedValueOnce(new WorkspaceError('NOT_FOUND', 'gone'));
    expect((await route.POST(post(BODY))).status).toBe(404);
  });
});

describe('GET /api/audit/export', () => {
  it('streams the export as an attachment, pulling lazily', async () => {
    state.authorize.mockResolvedValue('owner');
    const url = await link();
    const { stream, pulls } = counted(['\uFEFFid,created_at\r\n', 'a,b\r\n']);
    state.exportAudit.mockResolvedValue(stream);
    const res = await route.GET(
      get(url, { 'x-request-id': 'req-1', 'user-agent': 'UA/1', 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="audit-2026-01-01-2026-02-01.csv"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    // Not buffered: nothing was read before the body is consumed.
    expect(pulls.n).toBe(0);
    // Raw bytes: `text()` would drop the BOM.
    expect(Buffer.from(await res.arrayBuffer()).toString('utf8')).toBe('\uFEFFid,created_at\r\na,b\r\n');
    expect(state.exportAudit).toHaveBeenCalledWith(
      { db: { marker: 'db' }, workspaceId: WS, userId: USER, requestId: 'req-1', userAgent: 'UA/1', ip: '203.0.113.5' },
      { from: new Date(BODY.from), to: new Date(BODY.to), format: 'csv', bom: true },
    );
  });

  it('serves JSON Lines with its content type and file name', async () => {
    state.authorize.mockResolvedValue('advocate');
    const url = await link({ ...BODY, format: 'jsonl', bom: undefined });
    state.exportAudit.mockResolvedValue(counted(['{"id":"a"}\n']).stream);
    const res = await route.GET(get(url));
    expect(res.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="audit-2026-01-01-2026-02-01.jsonl"');
    expect(state.exportAudit.mock.calls[0]?.[1]).toMatchObject({ format: 'jsonl', bom: false });
  });

  it('rejects no session, bad, tampered, expired or someone else\'s tokens', async () => {
    state.authorize.mockResolvedValue('owner');
    const url = await link();
    state.session = null;
    expect((await route.GET(get(url))).status).toBe(401);
    state.session = { user: { id: USER } };
    for (const bad of ['/api/audit/export', '/api/audit/export?token=abc', `${url}x`]) {
      const res = await route.GET(get(bad));
      expect(res.status, bad).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_token' });
    }
    state.session = { user: { id: OTHER } };
    expect((await route.GET(get(url))).status).toBe(401);
    state.session = { user: { id: USER } };
    vi.useFakeTimers({ now: Date.now() + 60_001 });
    expect((await route.GET(get(url))).status).toBe(401);
    expect(state.exportAudit).not.toHaveBeenCalled();
  });

  it('maps a permission lost since the link was issued to 403, and a lost membership to 404', async () => {
    state.authorize.mockResolvedValue('advocate');
    const url = await link();
    state.exportAudit.mockRejectedValueOnce(new WorkspaceError('FORBIDDEN', 'no'));
    expect((await route.GET(get(url))).status).toBe(403);
    state.exportAudit.mockRejectedValueOnce(new WorkspaceError('NOT_FOUND', 'gone'));
    expect((await route.GET(get(url))).status).toBe(404);
  });
});
