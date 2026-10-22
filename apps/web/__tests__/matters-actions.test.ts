// Matters list server actions (#388). `createMatterAction` needs `matter.write` (owners, advocates,
// juniors), so clerks and viewers are FORBIDDEN before core runs; it calls `createMatter` with the
// workspace-scoped transaction as `deps.db` and returns only the id and title.
// `searchMattersAction` needs `matter.read` (every role), asks `searchMatters` for 8 matters and
// returns only what the palette row shows: id, title, forum, next date (formatted) and sensitive.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const MATTER = '00000000-0000-4000-8000-0000000c0001';
const TX = { scoped: true };

const state = vi.hoisted((): { session: AppSession | null; role: string | null } => ({
  session: null,
  role: 'owner',
}));

const runtime = vi.hoisted(() => ({
  memberRoleFor: vi.fn(() => Promise.resolve(state.role)),
  ownerGraceFor: vi.fn(() => Promise.resolve(null)),
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ scoped: true }),
  ),
  recordAccessDeniedFor: vi.fn(() => Promise.resolve()),
}));
const graph = vi.hoisted(() => ({ createMatter: vi.fn(), searchMatters: vi.fn() }));
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
vi.mock('@causedeck/core/matter-graph', () => graph);
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next-intl/server', async () => {
  const { fakeGetTranslations } = await import('./helpers/intl.ts');
  return {
    getLocale: () => Promise.resolve('en'),
    getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
  };
});

const actions = await import('../app/(app)/w/[slug]/matters/actions.ts');

beforeEach(() => {
  state.session = {
    session: { id: 'session-1' },
    user: { id: USER, name: 'Asha', email: 'a@x.test', twoFactorEnabled: true },
  } as unknown as AppSession;
  state.role = 'owner';
  graph.createMatter.mockResolvedValue({
    id: MATTER,
    title: 'Rao v. State',
    synopsis: 'privileged strategy',
    workspaceId: WS,
  });
  graph.searchMatters.mockResolvedValue({
    items: [
      {
        id: MATTER,
        title: 'Rao v. State',
        status: 'active',
        sensitive: true,
        petitioner: 'K. Rao',
        respondent: 'State',
        forum: { id: 'f1', court: 'Madras High Court', establishment: null, seat: 'Chennai' },
        stage: 'listed',
        proceedingCount: 2,
        nextDate: {
          date: '2026-11-14',
          proceedingId: 'p1',
          listingId: 'l1',
          sourceType: 'cause_list',
          confirmationState: 'proposed',
        },
        owner: { memberId: 'mem-1', userId: USER, name: 'Asha' },
        updatedAt: new Date('2026-10-20T00:00:00Z'),
      },
      {
        id: 'm2',
        title: 'Unlisted v. Nobody',
        status: 'active',
        sensitive: false,
        petitioner: null,
        respondent: null,
        forum: null,
        stage: null,
        proceedingCount: 0,
        nextDate: null,
        owner: null,
        updatedAt: new Date('2026-10-20T00:00:00Z'),
      },
    ],
    nextCursor: 'more',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createMatterAction (#388)', () => {
  it.each(['owner', 'advocate', 'junior'])('creates a matter for a %s', async (role) => {
    state.role = role;
    const result = await actions.createMatterAction({
      workspaceId: WS,
      title: '  Rao v. State ',
      practiceArea: ' civil ',
      sensitive: true,
    });
    expect(result).toEqual({ ok: true, data: { id: MATTER, title: 'Rao v. State' } });
    expect(graph.createMatter).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      { title: 'Rao v. State', practiceArea: 'civil', sensitive: true },
    );
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/matters', 'page');
  });

  it.each(['clerk', 'viewer'])('is FORBIDDEN for a %s before core runs', async (role) => {
    state.role = role;
    const result = await actions.createMatterAction({ workspaceId: WS, title: 'Rao v. State' });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(graph.createMatter).not.toHaveBeenCalled();
  });

  it('refuses a blank title', async () => {
    const result = await actions.createMatterAction({ workspaceId: WS, title: '   ' });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(graph.createMatter).not.toHaveBeenCalled();
  });

  it('is FORBIDDEN for a non-member', async () => {
    state.role = null;
    const result = await actions.createMatterAction({ workspaceId: WS, title: 'Rao v. State' });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('searchMattersAction (#388)', () => {
  it.each(['owner', 'clerk', 'viewer'])(
    'returns at most 8 palette hits for a %s, with only the row fields',
    async (role) => {
      state.role = role;
      const result = await actions.searchMattersAction({ workspaceId: WS, q: ' wp 45/26 ' });
      expect(graph.searchMatters).toHaveBeenCalledWith(
        expect.objectContaining({ db: TX }),
        { workspaceId: WS, userId: USER },
        { q: 'wp 45/26', limit: 8 },
      );
      expect(result).toEqual({
        ok: true,
        data: [
          {
            id: MATTER,
            title: 'Rao v. State',
            forum: 'Madras High Court',
            nextDate: {
              date: '2026-11-14',
              confirmationState: 'proposed',
              text: 'Sat, 14 Nov 2026',
            },
            noNextDateText: 'No next date',
            sensitive: true,
          },
          {
            id: 'm2',
            title: 'Unlisted v. Nobody',
            forum: null,
            nextDate: null,
            noNextDateText: 'No next date',
            sensitive: false,
          },
        ],
      });
    },
  );

  it('refuses an empty query and non-members', async () => {
    expect(await actions.searchMattersAction({ workspaceId: WS, q: '  ' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    state.role = null;
    expect(await actions.searchMattersAction({ workspaceId: WS, q: 'Rao' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(graph.searchMatters).not.toHaveBeenCalled();
  });
});
