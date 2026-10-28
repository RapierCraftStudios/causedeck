// Owner-facing brief sharing actions (#507). Both go through `workspaceAction`: a signed-out caller
// is UNAUTHENTICATED, a non-member and a non-owner (for creating) are FORBIDDEN before core runs,
// the input is strict (a day count out of range or a stray key is VALIDATION), the core service
// gets the workspace actor and the TTL in milliseconds, the token comes back once as a relative
// path, and a rate-limited share is a CONFLICT the panel recognises.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const LISTING = '00000000-0000-4000-8000-0000000c0001';
const SHARE = '00000000-0000-4000-8000-0000000d0001';

const state = vi.hoisted((): { session: AppSession | null; role: string | null } => ({
  session: null,
  role: 'owner',
}));
const runtime = vi.hoisted(() => ({
  db: { app: true },
  memberRoleFor: vi.fn(() => Promise.resolve(state.role)),
  ownerGraceFor: vi.fn(() => Promise.resolve(null)),
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
  recordAccessDeniedFor: vi.fn(() => Promise.resolve()),
}));
const core = vi.hoisted(() => ({
  createBriefShare: vi.fn(),
  revokeBriefShare: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('../lib/auth.ts', () => ({
  getSession: () => Promise.resolve(state.session),
  requireSession: () =>
    state.session
      ? Promise.resolve(state.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
}));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/shares', () => core);
vi.mock('next/cache', () => ({ revalidatePath }));

const { createBriefShareAction, revokeBriefShareAction } =
  await import('../app/(app)/w/[slug]/briefs/actions.ts');

const code = (result: unknown) => (result as { error?: { code?: string } }).error?.code;

beforeEach(() => {
  state.role = 'owner';
  state.session = {
    user: { id: USER, email: 'a@example.com', name: 'A' },
    session: { id: 's1' },
  } as unknown as AppSession;
  core.createBriefShare.mockResolvedValue({
    id: SHARE,
    token: 'tok_abc-123',
    expiresAt: new Date('2026-11-01T00:00:00.000Z'),
  });
  core.revokeBriefShare.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('createBriefShareAction', () => {
  it('creates a link for the owner with the TTL in ms and returns the token once, as a path', async () => {
    const result = await createBriefShareAction({
      workspaceId: WS,
      listingId: LISTING,
      expiresInDays: 14,
    });
    expect(result).toEqual({
      ok: true,
      data: { id: SHARE, path: '/share/tok_abc-123', expiresAt: '2026-11-01T00:00:00.000Z' },
    });
    expect(core.createBriefShare).toHaveBeenCalledWith(
      { db: runtime.db },
      { workspaceId: WS, userId: USER },
      LISTING,
      { ttlMs: 14 * 24 * 60 * 60 * 1000 },
    );
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('defaults to seven days', async () => {
    await createBriefShareAction({ workspaceId: WS, listingId: LISTING });
    expect(core.createBriefShare.mock.calls[0]?.[3]).toEqual({ ttlMs: 7 * 24 * 60 * 60 * 1000 });
  });

  it('is UNAUTHENTICATED when signed out and FORBIDDEN for a non-member or a non-owner', async () => {
    state.session = null;
    expect(code(await createBriefShareAction({ workspaceId: WS, listingId: LISTING }))).toBe(
      'UNAUTHENTICATED',
    );
    state.session = { user: { id: USER }, session: { id: 's1' } } as unknown as AppSession;
    state.role = null;
    expect(code(await createBriefShareAction({ workspaceId: WS, listingId: LISTING }))).toBe(
      'FORBIDDEN',
    );
    state.role = 'junior';
    expect(code(await createBriefShareAction({ workspaceId: WS, listingId: LISTING }))).toBe(
      'FORBIDDEN',
    );
    expect(core.createBriefShare).not.toHaveBeenCalled();
  });

  it('rejects a bad listing id, an out-of-range expiry and stray keys', async () => {
    for (const bad of [
      { workspaceId: WS, listingId: 'nope' },
      { workspaceId: WS, listingId: LISTING, expiresInDays: 0 },
      { workspaceId: WS, listingId: LISTING, expiresInDays: 31 },
      { workspaceId: WS, listingId: LISTING, expiresInDays: 1.5 },
      { workspaceId: WS, listingId: LISTING, token: 'x' },
    ]) {
      expect(code(await createBriefShareAction(bad)), JSON.stringify(bad)).toBe('VALIDATION');
    }
    expect(core.createBriefShare).not.toHaveBeenCalled();
  });

  it('maps the rate limit to a CONFLICT the panel recognises and passes domain denials through', async () => {
    core.createBriefShare.mockRejectedValueOnce(
      Object.assign(new Error('Too many'), { name: 'WorkspaceError', code: 'RATE_LIMITED' }),
    );
    expect(await createBriefShareAction({ workspaceId: WS, listingId: LISTING })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: 'RATE_LIMITED' },
    });
    core.createBriefShare.mockRejectedValueOnce(
      Object.assign(new Error('A sensitive matter cannot be shared'), {
        name: 'WorkspaceError',
        code: 'FORBIDDEN',
      }),
    );
    expect(await createBriefShareAction({ workspaceId: WS, listingId: LISTING })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'A sensitive matter cannot be shared' },
    });
  });
});

describe('revokeBriefShareAction', () => {
  it('revokes through core with the workspace actor', async () => {
    expect(await revokeBriefShareAction({ workspaceId: WS, shareId: SHARE })).toEqual({
      ok: true,
      data: { id: SHARE },
    });
    expect(core.revokeBriefShare).toHaveBeenCalledWith(
      { db: runtime.db },
      { workspaceId: WS, userId: USER },
      SHARE,
    );
  });

  it('is FORBIDDEN for a non-member, VALIDATION for a bad id and passes core denials through', async () => {
    state.role = null;
    expect(code(await revokeBriefShareAction({ workspaceId: WS, shareId: SHARE }))).toBe(
      'FORBIDDEN',
    );
    state.role = 'owner';
    expect(code(await revokeBriefShareAction({ workspaceId: WS, shareId: 'nope' }))).toBe(
      'VALIDATION',
    );
    core.revokeBriefShare.mockRejectedValueOnce(
      Object.assign(new Error('Share already revoked'), {
        name: 'WorkspaceError',
        code: 'CONFLICT',
      }),
    );
    expect(await revokeBriefShareAction({ workspaceId: WS, shareId: SHARE })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: 'Share already revoked' },
    });
  });
});
