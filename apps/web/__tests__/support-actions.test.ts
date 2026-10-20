// Support access server actions (#313): each runs through `workspaceAction` (zod, `requireSession`,
// membership) with the owner-only `support.manage` action, then calls the support domain on the
// workspace-scoped transaction. Grants default to 1 hour and accept only 1, 2 or 4 hours.
import type { AppSession } from '../lib/auth.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const SESSION = '00000000-0000-4000-8000-0000000e0001';
const TX = { scoped: true };

const state = vi.hoisted((): { session: AppSession | null; role: string | null } => ({
  session: null,
  role: 'owner',
}));

const row = (status: string, expiresAt: Date | null = null) => ({ id: SESSION, status, expiresAt });

const support = vi.hoisted(() => ({
  grantSession: vi.fn(),
  denySession: vi.fn(),
  revokeSession: vi.fn(),
}));
const workspaces = vi.hoisted(() => ({ memberRole: vi.fn(() => Promise.resolve(state.role)) }));
const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
);
const revalidatePath = vi.hoisted(() => vi.fn());
const recordAccessDenied = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../lib/auth.ts', () => ({
  requireSession: () =>
    state.session
      ? Promise.resolve(state.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
}));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' }, withWorkspace }));
vi.mock('@causedeck/core/workspaces', () => workspaces);
vi.mock('@causedeck/core/support', () => support);
vi.mock('@causedeck/core/audit', () => ({ recordAccessDenied }));
vi.mock('next/cache', () => ({ revalidatePath }));

const actions = await import('../app/(app)/w/[slug]/settings/support/actions.ts');

class WorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

const ctx = { db: TX, userId: USER, workspaceId: WS };

beforeEach(() => {
  state.session = {
    session: {},
    user: { id: USER, name: 'Asha', email: 'a@x.test' },
  } as AppSession;
  state.role = 'owner';
  const expires = new Date('2026-10-20T09:00:00Z');
  support.grantSession.mockResolvedValue(row('granted', expires));
  support.denySession.mockResolvedValue(row('denied'));
  support.revokeSession.mockResolvedValue(row('ended'));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('grantSupportSessionAction', () => {
  it('grants for 60 minutes by default on the workspace transaction', async () => {
    const result = await actions.grantSupportSessionAction({ workspaceId: WS, sessionId: SESSION });
    expect(result).toEqual({
      ok: true,
      data: { sessionId: SESSION, status: 'granted', expiresAt: '2026-10-20T09:00:00.000Z' },
    });
    expect(withWorkspace).toHaveBeenCalledWith(
      { fake: 'db' },
      { workspaceId: WS, userId: USER },
      expect.any(Function),
    );
    expect(support.grantSession).toHaveBeenCalledWith(ctx, { sessionId: SESSION, minutes: 60 });
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings/support', 'page');
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]', 'layout');
  });

  it.each([120, 240])('grants for %i minutes', async (minutes) => {
    await actions.grantSupportSessionAction({ workspaceId: WS, sessionId: SESSION, minutes });
    expect(support.grantSession).toHaveBeenCalledWith(ctx, { sessionId: SESSION, minutes });
  });

  it.each([0, 30, 241, 300, '60'])('rejects a length of %s as VALIDATION', async (minutes) => {
    const result = await actions.grantSupportSessionAction({
      workspaceId: WS,
      sessionId: SESSION,
      minutes,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(support.grantSession).not.toHaveBeenCalled();
  });

  it('returns the domain CONFLICT when the session is no longer pending (no extension)', async () => {
    support.grantSession.mockRejectedValue(
      new WorkspaceError('CONFLICT', 'Only a pending request can be granted'),
    );
    const result = await actions.grantSupportSessionAction({ workspaceId: WS, sessionId: SESSION });
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('owner-only policy (support.manage)', () => {
  it.each(['advocate', 'junior', 'clerk', 'viewer'])(
    'a %s is FORBIDDEN before any support call',
    async (role) => {
      state.role = role;
      for (const call of [
        actions.grantSupportSessionAction,
        actions.denySupportSessionAction,
        actions.revokeSupportSessionAction,
      ]) {
        const result = await call({ workspaceId: WS, sessionId: SESSION });
        expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      }
      expect(support.grantSession).not.toHaveBeenCalled();
      expect(support.denySession).not.toHaveBeenCalled();
      expect(support.revokeSession).not.toHaveBeenCalled();
      expect(withWorkspace).not.toHaveBeenCalled();
    },
  );

  it('a non-member is FORBIDDEN and a signed-out caller UNAUTHENTICATED', async () => {
    state.role = null;
    expect(
      await actions.revokeSupportSessionAction({ workspaceId: WS, sessionId: SESSION }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    state.session = null;
    expect(
      await actions.revokeSupportSessionAction({ workspaceId: WS, sessionId: SESSION }),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('validates the session id', async () => {
    const result = await actions.denySupportSessionAction({ workspaceId: WS, sessionId: 'nope' });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('deny and revoke', () => {
  it('denies a pending request on the workspace transaction', async () => {
    const result = await actions.denySupportSessionAction({ workspaceId: WS, sessionId: SESSION });
    expect(result).toEqual({
      ok: true,
      data: { sessionId: SESSION, status: 'denied', expiresAt: null },
    });
    expect(support.denySession).toHaveBeenCalledWith(ctx, { sessionId: SESSION });
  });

  it('revokes (Revoke now / End session) on the workspace transaction and refreshes the shell', async () => {
    const result = await actions.revokeSupportSessionAction({
      workspaceId: WS,
      sessionId: SESSION,
    });
    expect(result).toMatchObject({ ok: true, data: { status: 'ended' } });
    expect(support.revokeSession).toHaveBeenCalledWith(ctx, { sessionId: SESSION });
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]', 'layout');
  });

  it('maps an unknown session to NOT_FOUND', async () => {
    support.revokeSession.mockRejectedValue(
      new WorkspaceError('NOT_FOUND', 'Support session not found'),
    );
    const result = await actions.revokeSupportSessionAction({
      workspaceId: WS,
      sessionId: SESSION,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
