// The conflict-check action (#500, D-048). With the legal-gated flag `conflicts.check` off it is
// NOT_FOUND before core runs; with it on it calls `checkConflicts` in the workspace transaction and
// returns the hits without their score. The flag is registered legal-gated and off by default.
import { FLAGS } from '@causedeck/flags/keys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const MATTER = '00000000-0000-4000-8000-0000000c0001';

const state = vi.hoisted((): { session: AppSession | null; flag: boolean } => ({
  session: null,
  flag: true,
}));
const runtime = vi.hoisted(() => ({
  memberRoleFor: vi.fn(() => Promise.resolve('owner')),
  ownerGraceFor: vi.fn(() => Promise.resolve(null)),
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ scoped: true }),
  ),
  recordAccessDeniedFor: vi.fn(() => Promise.resolve()),
}));
const conflicts = vi.hoisted(() => ({ checkConflicts: vi.fn() }));

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
vi.mock('@causedeck/core/conflicts', () => conflicts);
vi.mock('@causedeck/flags/server', () => ({ isEnabled: () => Promise.resolve(state.flag) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', async () => {
  const { fakeGetTranslations } = await import('./helpers/intl.ts');
  return {
    getLocale: () => Promise.resolve('en'),
    getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
  };
});

const actions = await import('../app/(app)/w/[slug]/matters/actions.ts');

const INPUT = { workspaceId: WS, parties: [{ name: 'முருகன்', side: 'adverse' }] };

beforeEach(() => {
  state.flag = true;
  state.session = {
    session: { id: 'session-1' },
    user: { id: USER, name: 'Asha', email: 'a@x.test', twoFactorEnabled: true },
  } as unknown as AppSession;
  conflicts.checkConflicts.mockResolvedValue({
    checked: 1,
    hits: [
      {
        checked: 'முருகன்',
        side: 'adverse',
        matterId: MATTER,
        matterTitle: 'Murugan v State',
        matchedName: 'Murugan',
        source: 'name',
        existingRole: 'client',
        score: 1,
      },
    ],
  });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('checkConflictsAction', () => {
  it('is NOT_FOUND while conflicts.check is off, and core never runs', async () => {
    state.flag = false;
    expect(await actions.checkConflictsAction(INPUT)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(conflicts.checkConflicts).not.toHaveBeenCalled();
  });

  it('returns the hits without the score while the flag is on', async () => {
    const result = await actions.checkConflictsAction(INPUT);
    expect(result).toEqual({
      ok: true,
      data: [
        {
          checked: 'முருகன்',
          side: 'adverse',
          matterId: MATTER,
          matterTitle: 'Murugan v State',
          matchedName: 'Murugan',
          source: 'name',
          existingRole: 'client',
        },
      ],
    });
    expect(conflicts.checkConflicts).toHaveBeenCalledWith(
      { db: { scoped: true } },
      { workspaceId: WS, userId: USER },
      { parties: INPUT.parties },
    );
  });

  it('rejects an empty party list', async () => {
    expect(await actions.checkConflictsAction({ workspaceId: WS, parties: [] })).toMatchObject({
      ok: false,
    });
    expect(conflicts.checkConflicts).not.toHaveBeenCalled();
  });

  it('registers the flag as legal-gated', () => {
    expect(FLAGS['conflicts.check'].legalGated).toBe(true);
  });
});
