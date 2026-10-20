// Privacy settings server action (#286): `workspaceAction` validates with zod (strict: India-only AI
// is not an input), rejects non-members, juniors, clerks and viewers (`workspace.manage`) with FORBIDDEN
// before any write, and calls the domain service (which records the `workspace.privacy_updated`
// audit event) on the workspace-scoped transaction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const TX = { scoped: true };

interface State {
  session: AppSession | null;
  role: string | null;
}

const state = vi.hoisted((): State => ({ session: null, role: 'owner' }));

const core = vi.hoisted(() => ({
  memberRole: vi.fn(() => Promise.resolve(state.role)),
  updateWorkspacePrivacy: vi.fn(),
}));

const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
);
const revalidatePath = vi.hoisted(() => vi.fn());

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
vi.mock('@causedeck/core/workspaces', () => core);
vi.mock('next/cache', () => ({ revalidatePath }));

const { updateWorkspacePrivacyAction } =
  await import('../app/(app)/w/[slug]/settings/privacy/actions.ts');

const input = { workspaceId: WS, sensitiveDefaultRestricted: false, retentionAudioDays: 14 };

beforeEach(() => {
  state.session = {
    session: {},
    user: { id: USER, name: 'Asha', email: 'a@x.test' },
  } as AppSession;
  state.role = 'owner';
  core.updateWorkspacePrivacy.mockImplementation(
    (_tx: unknown, request: { input: Record<string, unknown> }) =>
      Promise.resolve({
        settings: { indiaOnlyAi: true, ...request.input },
        changed: ['sensitiveDefaultRestricted'],
      }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateWorkspacePrivacyAction', () => {
  it.each(['owner', 'advocate'])(
    'saves the settings for an %s on the workspace transaction',
    async (role) => {
      state.role = role;
      expect(await updateWorkspacePrivacyAction(input)).toEqual({
        ok: true,
        data: { indiaOnlyAi: true, sensitiveDefaultRestricted: false, retentionAudioDays: 14 },
      });
      expect(withWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        { workspaceId: WS, userId: USER },
        expect.any(Function),
      );
      expect(core.updateWorkspacePrivacy).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({
          workspaceId: WS,
          actorUserId: USER,
          input: { sensitiveDefaultRestricted: false, retentionAudioDays: 14 },
          requestId: expect.any(String) as string,
        }),
      );
      expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings', 'layout');
    },
  );

  it.each(['junior', 'clerk', 'viewer', null])(
    'returns FORBIDDEN for %s before any write',
    async (role) => {
      state.role = role;
      expect(await updateWorkspacePrivacyAction(input)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(core.updateWorkspacePrivacy).not.toHaveBeenCalled();
    },
  );

  it('rejects India-only AI, other windows and bad input with VALIDATION', async () => {
    for (const bad of [
      { ...input, indiaOnlyAi: false },
      { ...input, retentionAudioDays: 90 },
      { ...input, retentionAudioDays: '30' },
      { workspaceId: WS, sensitiveDefaultRestricted: true },
      { ...input, workspaceId: 'not-a-uuid' },
    ]) {
      expect(await updateWorkspacePrivacyAction(bad)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
    expect(core.updateWorkspacePrivacy).not.toHaveBeenCalled();
  });

  it('is UNAUTHENTICATED when signed out', async () => {
    state.session = null;
    expect(await updateWorkspacePrivacyAction(input)).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('returns a domain FORBIDDEN from the service as FORBIDDEN', async () => {
    core.updateWorkspacePrivacy.mockRejectedValue(
      Object.assign(new Error('You cannot do that'), { name: 'WorkspaceError', code: 'FORBIDDEN' }),
    );
    expect(await updateWorkspacePrivacyAction(input)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
