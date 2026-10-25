// Role settings server action (#285): `workspaceAction` validates with zod, rejects non-members and
// every role below owner (`member.role`) with FORBIDDEN before any write, and calls the domain
// service (which records the `workspace.role_settings_updated` audit event) on the
// workspace-scoped transaction.
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
  updateRoleSettings: vi.fn(),
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

const { updateRoleSettingsAction } =
  await import('../app/(app)/w/[slug]/settings/roles/actions.ts');

const input = { workspaceId: WS, advocatesCanInvite: false, ownersSeeRestrictedMatters: true };

beforeEach(() => {
  state.session = {
    session: {},
    user: { id: USER, name: 'Asha', email: 'a@x.test' },
  } as AppSession;
  state.role = 'owner';
  core.updateRoleSettings.mockImplementation(
    (_tx: unknown, request: { input: Record<string, boolean> }) =>
      Promise.resolve({ settings: { ...request.input }, changed: ['advocatesCanInvite'] }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateRoleSettingsAction', () => {
  it('saves the settings on the workspace transaction and returns them', async () => {
    expect(await updateRoleSettingsAction(input)).toEqual({
      ok: true,
      data: { advocatesCanInvite: false, ownersSeeRestrictedMatters: true },
    });
    expect(withWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      { workspaceId: WS, userId: USER },
      expect.any(Function),
    );
    expect(core.updateRoleSettings).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        workspaceId: WS,
        actorUserId: USER,
        input: { advocatesCanInvite: false, ownersSeeRestrictedMatters: true },
        requestId: expect.any(String) as string,
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings', 'layout');
  });

  it.each(['advocate', 'junior', 'clerk', 'viewer', null])(
    'returns FORBIDDEN for %s before any write',
    async (role) => {
      state.role = role;
      expect(await updateRoleSettingsAction(input)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(core.updateRoleSettings).not.toHaveBeenCalled();
      expect(withWorkspace).not.toHaveBeenCalledWith(
        expect.anything(),
        { workspaceId: WS, userId: USER },
        expect.any(Function),
      );
    },
  );

  it('rejects invalid input with VALIDATION', async () => {
    for (const bad of [
      { workspaceId: WS, advocatesCanInvite: 'no', ownersSeeRestrictedMatters: true },
      { workspaceId: WS, advocatesCanInvite: true },
      { workspaceId: 'not-a-uuid', advocatesCanInvite: true, ownersSeeRestrictedMatters: true },
    ]) {
      expect(await updateRoleSettingsAction(bad)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
    expect(core.updateRoleSettings).not.toHaveBeenCalled();
  });

  it('is UNAUTHENTICATED when signed out', async () => {
    state.session = null;
    expect(await updateRoleSettingsAction(input)).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('returns a domain FORBIDDEN from the service as FORBIDDEN', async () => {
    core.updateRoleSettings.mockRejectedValue(
      Object.assign(new Error('You cannot do that'), { name: 'WorkspaceError', code: 'FORBIDDEN' }),
    );
    expect(await updateRoleSettingsAction(input)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
