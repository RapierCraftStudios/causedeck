// Workspace profile server action (#284): `workspaceAction` validates with zod, rejects non-members
// and roles without `workspace.manage` with FORBIDDEN, asserts `workspace.rename` (owners only)
// before a slug change, and calls the domain service (which writes the audit events) on the
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

const current = {
  id: '00000000-0000-4000-8000-00000000a001',
  name: 'Iyer Chambers',
  slug: 'iyer-chambers',
  kind: 'solo',
  timezone: 'Asia/Kolkata',
  locale: 'en',
  practiceCity: null,
};

const core = vi.hoisted(() => ({
  memberRole: vi.fn(() => Promise.resolve(state.role)),
  getWorkspaceProfile: vi.fn(),
  updateWorkspaceProfile: vi.fn(),
  toProfileView: (profile: Record<string, unknown>) => {
    const view = { ...profile };
    delete view.id;
    return view;
  },
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

const { updateWorkspaceProfileAction } =
  await import('../app/(app)/w/[slug]/settings/profile/actions.ts');

const input = {
  workspaceId: WS,
  name: '  Iyer & Rao Chambers ',
  kind: 'chamber',
  timezone: 'Asia/Kolkata',
  locale: 'ta',
  practiceCity: ' Chennai ',
};

beforeEach(() => {
  state.session = {
    session: {},
    user: { id: USER, name: 'Asha', email: 'a@x.test' },
  } as AppSession;
  state.role = 'owner';
  core.getWorkspaceProfile.mockResolvedValue(current);
  core.updateWorkspaceProfile.mockImplementation(
    (_tx: unknown, request: { input: Record<string, unknown> }) =>
      Promise.resolve({
        profile: { ...current, ...request.input, slug: request.input.slug ?? current.slug },
        changed: [],
        renamed: null,
      }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateWorkspaceProfileAction', () => {
  it('saves the trimmed profile on the workspace transaction and returns the view', async () => {
    const result = await updateWorkspaceProfileAction(input);
    expect(result).toEqual({
      ok: true,
      data: {
        name: 'Iyer & Rao Chambers',
        slug: 'iyer-chambers',
        kind: 'chamber',
        timezone: 'Asia/Kolkata',
        locale: 'ta',
        practiceCity: 'Chennai',
      },
    });
    expect(withWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      { workspaceId: WS, userId: USER },
      expect.any(Function),
    );
    expect(core.updateWorkspaceProfile).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        workspaceId: WS,
        actorUserId: USER,
        input: {
          name: 'Iyer & Rao Chambers',
          kind: 'chamber',
          timezone: 'Asia/Kolkata',
          locale: 'ta',
          practiceCity: 'Chennai',
        },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings', 'layout');
  });

  it('lets an advocate save the profile (workspace.manage)', async () => {
    state.role = 'advocate';
    expect(await updateWorkspaceProfileAction(input)).toMatchObject({ ok: true });
  });

  it.each(['junior', 'clerk', 'viewer', null])(
    'returns FORBIDDEN for %s before any write',
    async (role) => {
      state.role = role;
      expect(await updateWorkspaceProfileAction(input)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(core.updateWorkspaceProfile).not.toHaveBeenCalled();
    },
  );

  it('returns FORBIDDEN when a non-owner changes the slug', async () => {
    state.role = 'advocate';
    expect(await updateWorkspaceProfileAction({ ...input, slug: 'rao-chambers' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(core.updateWorkspaceProfile).not.toHaveBeenCalled();
  });

  it('lets a non-owner resubmit the unchanged slug', async () => {
    state.role = 'advocate';
    expect(await updateWorkspaceProfileAction({ ...input, slug: 'iyer-chambers' })).toMatchObject({
      ok: true,
    });
  });

  it('lets the owner rename the slug and returns the new one', async () => {
    const result = await updateWorkspaceProfileAction({ ...input, slug: 'rao-chambers' });
    expect(result).toMatchObject({ ok: true, data: { slug: 'rao-chambers' } });
  });

  it.each([
    { name: '' },
    { kind: 'firm' },
    { timezone: 'Mars/Olympus' },
    { locale: 'fr' },
    { practiceCity: 'x'.repeat(81) },
    { slug: 'Bad Slug' },
    { workspaceId: 'not-a-uuid' },
  ])('rejects %j with VALIDATION', async (patch) => {
    const result = await updateWorkspaceProfileAction({ ...input, ...patch });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(core.updateWorkspaceProfile).not.toHaveBeenCalled();
  });

  it('maps a taken slug to CONFLICT', async () => {
    core.updateWorkspaceProfile.mockRejectedValue(
      Object.assign(new Error('This slug is taken'), { name: 'WorkspaceError', code: 'CONFLICT' }),
    );
    expect(await updateWorkspaceProfileAction({ ...input, slug: 'taken-one' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: 'This slug is taken' },
    });
  });

  it('rejects a signed-out caller as UNAUTHENTICATED', async () => {
    state.session = null;
    expect(await updateWorkspaceProfileAction(input)).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
});
