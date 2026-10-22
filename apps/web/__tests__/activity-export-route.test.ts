// `/api/activity/export` (#49): 401 signed out, 400 bad input, 403 when core refuses, 404 for a
// non-member, and CSV or JSON with the audit fields (input source, model, version, region,
// confidence, level, who confirmed, time, undo state) with spreadsheet formulas neutralised.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  guard: vi.fn(),
  exportActivitiesFor: vi.fn(),
}));

vi.mock('../lib/auth.ts', () => ({ getSession: () => Promise.resolve(state.session) }));
vi.mock('../lib/guard.ts', () => ({
  guard: state.guard,
  guardResponse: (error: unknown) =>
    error instanceof Error && error.message === 'DENIED'
      ? Response.json({ error: 'forbidden' }, { status: 403 })
      : null,
}));
vi.mock('@causedeck/core/runtime', () => ({ exportActivitiesFor: state.exportActivitiesFor }));
vi.mock('@causedeck/core/workspaces', () => ({
  WorkspaceError: class WorkspaceError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { GET } = await import('../app/api/activity/export/route.ts');
const { WorkspaceError } = await import('@causedeck/core/workspaces');

const WORKSPACE = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000000a1';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  created_at: '2026-10-21T03:00:00.000Z',
  kind: 'document_attach',
  level: 'L3',
  actor: 'system',
  actor_user_id: null,
  summary: 'Attached order to W.P. 12345 of 2026',
  input_source: 'document',
  model: 'sarvam-m',
  model_version: '2026-09',
  region: 'ap-south-1',
  confidence: '0.930',
  confirmed_by: null,
  confirmed_at: null,
  undo_payload: { attached: true },
  undo_expires_at: '2026-10-28T03:00:00.000Z',
  undone_at: null,
  undone_by: null,
  parent_activity_id: null,
  cascade_group_id: null,
  capture_id: null,
  ...overrides,
});

function request(params: Record<string, string> = {}) {
  const query = new URLSearchParams({
    workspaceId: WORKSPACE,
    from: '2026-10-01T00:00:00+05:30',
    to: '2026-10-22T00:00:00+05:30',
    format: 'csv',
    ...params,
  });
  return new Request(`https://app.causedeck.test/api/activity/export?${query.toString()}`);
}

beforeEach(() => {
  state.session = { user: { id: USER } };
  state.guard.mockResolvedValue({ userId: USER });
  state.exportActivitiesFor.mockResolvedValue([row()]);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/activity/export', () => {
  it('is 401 when signed out and 400 for bad input, and reads nothing', async () => {
    state.session = null;
    expect((await GET(request())).status).toBe(401);
    state.session = { user: { id: USER } };
    expect((await GET(request({ format: 'xml' }))).status).toBe(400);
    expect((await GET(request({ workspaceId: 'nope' }))).status).toBe(400);
    expect(
      (await GET(request({ from: '2026-10-22T00:00:00+05:30', to: '2026-10-01T00:00:00+05:30' })))
        .status,
    ).toBe(400);
    expect(state.exportActivitiesFor).not.toHaveBeenCalled();
  });

  it('checks the owner 2FA policy as an export, then reads in the member scope', async () => {
    await GET(request());
    expect(state.guard).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      session: state.session,
      destructive: true,
    });
    expect(state.exportActivitiesFor).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE, userId: USER },
      {
        from: new Date('2026-09-30T18:30:00.000Z'),
        to: new Date('2026-10-21T18:30:00.000Z'),
        limit: 1000,
      },
    );
  });

  it('answers 403 when the guard refuses and 404 when core says not found', async () => {
    state.guard.mockRejectedValueOnce(new Error('DENIED'));
    expect((await GET(request())).status).toBe(403);
    state.exportActivitiesFor.mockRejectedValueOnce(
      new (WorkspaceError as unknown as new (code: string, message: string) => Error)(
        'NOT_FOUND',
        'Workspace not found',
      ),
    );
    expect((await GET(request())).status).toBe(404);
    state.exportActivitiesFor.mockRejectedValueOnce(new Error('db down'));
    await expect(GET(request())).rejects.toThrow('db down');
  });

  it('returns CSV with every audit field and neutralises spreadsheet formulas', async () => {
    state.exportActivitiesFor.mockResolvedValue([
      row({
        summary: '=HYPERLINK("http://x")',
        confirmed_by: USER,
        confirmed_at: '2026-10-21T04:00:00.000Z',
      }),
    ]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('activity-2026-10-01-');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const [header, line] = (await response.text()).trim().split('\r\n');
    expect(header).toBe(
      'id,created_at,kind,level,actor,actor_user_id,summary,input_source,model,model_version,region,confidence,confirmed_by,confirmed_at,undo_payload,undo_expires_at,undone_at,undone_by,parent_activity_id,cascade_group_id,capture_id',
    );
    expect(line).toContain('"\'=HYPERLINK(""http://x"")"');
    expect(line).toContain('sarvam-m,2026-09,ap-south-1,0.930');
    expect(line).toContain(`${USER},2026-10-21T04:00:00.000Z`);
  });

  it('returns JSON rows when asked', async () => {
    const response = await GET(request({ format: 'json' }));
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as ReturnType<typeof row>[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ level: 'L3', region: 'ap-south-1', undone_at: null });
  });
});
