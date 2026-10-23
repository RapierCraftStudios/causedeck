// Matter workspace server actions (#390). Each validates its input with zod, refuses a role below
// its policy action with FORBIDDEN before core runs (`matter.write` for the synopsis and the next
// date; `matter.restrict`, owners and advocates, for the sensitive flag), passes the
// workspace-scoped transaction as `deps.db`, returns `{ok: true, data}` of the documented shape
// and maps a domain NOT_FOUND or CONFLICT from core to the same code. `updateMatterAction` never
// forwards the sensitive flag or the owner.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const MATTER = '00000000-0000-4000-8000-0000000c0001';
const CURRENT = '00000000-0000-4000-8000-0000000d0001';
const PROPOSED = '00000000-0000-4000-8000-0000000d0002';
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
const graph = vi.hoisted(() => ({
  updateMatter: vi.fn(),
  setSensitive: vi.fn(),
  confirmNextDate: vi.fn(),
  chooseNextDateSource: vi.fn(),
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
vi.mock('@causedeck/core/matter-graph', () => graph);
vi.mock('next/cache', () => ({ revalidatePath }));

const actions = await import('../app/(app)/w/[slug]/matters/[id]/actions.ts');

class WorkspaceError extends Error {
  override name = 'WorkspaceError';
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

const listingRow = (id: string, date: string) => ({
  id,
  listDate: date,
  confirmationState: 'confirmed',
  canonical: true,
  proceedingId: 'p1',
  sourceRef: 'secret',
});

beforeEach(() => {
  state.session = {
    session: { id: 'session-1' },
    user: { id: USER, name: 'Asha', email: 'a@x.test', twoFactorEnabled: true },
  } as unknown as AppSession;
  state.role = 'owner';
  graph.updateMatter.mockResolvedValue({
    id: MATTER,
    title: 'Rao v. State',
    synopsis: 'Notes',
    sensitive: true,
    workspaceId: WS,
  });
  graph.setSensitive.mockResolvedValue({ id: MATTER, sensitive: true, title: 'Rao v. State' });
  graph.confirmNextDate.mockResolvedValue(listingRow(CURRENT, '2026-11-14'));
  graph.chooseNextDateSource.mockResolvedValue(listingRow(PROPOSED, '2026-11-21'));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateMatterAction (#390)', () => {
  it.each(['owner', 'advocate', 'junior'])('saves the synopsis for a %s', async (role) => {
    state.role = role;
    const result = await actions.updateMatterAction({
      workspaceId: WS,
      matterId: MATTER,
      patch: { synopsis: '  Notes  ' },
    });
    expect(result).toEqual({
      ok: true,
      data: { id: MATTER, title: 'Rao v. State', synopsis: 'Notes' },
    });
    expect(graph.updateMatter).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      { matterId: MATTER, patch: { synopsis: 'Notes' } },
    );
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/matters/[id]', 'layout');
  });

  it('clears an empty synopsis and changes the title', async () => {
    await actions.updateMatterAction({
      workspaceId: WS,
      matterId: MATTER,
      patch: { synopsis: ' ' },
    });
    expect(graph.updateMatter).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), {
      matterId: MATTER,
      patch: { synopsis: null },
    });
    await actions.updateMatterAction({
      workspaceId: WS,
      matterId: MATTER,
      patch: { title: ' T ' },
    });
    expect(graph.updateMatter).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), {
      matterId: MATTER,
      patch: { title: 'T' },
    });
  });

  it('never forwards the sensitive flag or the owner, and needs a field', async () => {
    for (const patch of [{ sensitive: false }, { ownerMemberId: USER }, {}]) {
      const result = await actions.updateMatterAction({ workspaceId: WS, matterId: MATTER, patch });
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    }
    expect(
      await actions.updateMatterAction({
        workspaceId: WS,
        matterId: 'nope',
        patch: { title: 'T' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(graph.updateMatter).not.toHaveBeenCalled();
  });

  it.each(['clerk', 'viewer'])('is FORBIDDEN for a %s before core runs', async (role) => {
    state.role = role;
    const result = await actions.updateMatterAction({
      workspaceId: WS,
      matterId: MATTER,
      patch: { synopsis: 'x' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(graph.updateMatter).not.toHaveBeenCalled();
  });

  it('is FORBIDDEN for a non-member', async () => {
    state.role = null;
    const result = await actions.updateMatterAction({
      workspaceId: WS,
      matterId: MATTER,
      patch: { synopsis: 'x' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('passes a domain NOT_FOUND through (another matter, a restricted one)', async () => {
    graph.updateMatter.mockRejectedValue(new WorkspaceError('NOT_FOUND', 'Matter not found'));
    const result = await actions.updateMatterAction({
      workspaceId: WS,
      matterId: MATTER,
      patch: { synopsis: 'x' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('setSensitiveAction (#390)', () => {
  it.each(['owner', 'advocate'])('sets the flag for a %s', async (role) => {
    state.role = role;
    const result = await actions.setSensitiveAction({
      workspaceId: WS,
      matterId: MATTER,
      sensitive: true,
    });
    expect(result).toEqual({ ok: true, data: { id: MATTER, sensitive: true } });
    expect(graph.setSensitive).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      { matterId: MATTER, sensitive: true },
    );
  });

  it.each(['junior', 'clerk', 'viewer'])('is FORBIDDEN for a %s', async (role) => {
    state.role = role;
    const result = await actions.setSensitiveAction({
      workspaceId: WS,
      matterId: MATTER,
      sensitive: true,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(graph.setSensitive).not.toHaveBeenCalled();
  });

  it('needs a boolean', async () => {
    const result = await actions.setSensitiveAction({
      workspaceId: WS,
      matterId: MATTER,
      sensitive: 'yes',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('confirmNextDateAction (#390)', () => {
  it('confirms a listing, never a past one, and returns only the date fields', async () => {
    const result = await actions.confirmNextDateAction({ workspaceId: WS, listingId: CURRENT });
    expect(result).toEqual({
      ok: true,
      data: { listingId: CURRENT, date: '2026-11-14', confirmationState: 'confirmed' },
    });
    expect(graph.confirmNextDate).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      { listingId: CURRENT, allowPast: false },
    );
  });

  it('refuses a bad id, viewers and clerks', async () => {
    expect(await actions.confirmNextDateAction({ workspaceId: WS, listingId: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    for (const role of ['viewer', 'clerk']) {
      state.role = role;
      expect(
        await actions.confirmNextDateAction({ workspaceId: WS, listingId: CURRENT }),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(graph.confirmNextDate).not.toHaveBeenCalled();
  });
});

describe('chooseNextDateSourceAction (#390)', () => {
  const base = { workspaceId: WS, currentListingId: CURRENT, proposedListingId: PROPOSED };

  it('passes each choice to core; manual sends the typed date', async () => {
    const result = await actions.chooseNextDateSourceAction({ ...base, choice: 'proposed' });
    expect(result).toEqual({
      ok: true,
      data: { listingId: PROPOSED, date: '2026-11-21', confirmationState: 'confirmed' },
    });
    expect(graph.chooseNextDateSource).toHaveBeenLastCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      { currentListingId: CURRENT, proposedListingId: PROPOSED, choice: 'proposed' },
    );
    await actions.chooseNextDateSourceAction({ ...base, choice: 'manual', date: '2026-12-01' });
    expect(graph.chooseNextDateSource).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      {
        currentListingId: CURRENT,
        proposedListingId: PROPOSED,
        choice: 'manual',
        date: '2026-12-01',
      },
    );
  });

  it('refuses a manual choice without a date and a date on another choice', async () => {
    const manual = await actions.chooseNextDateSourceAction({ ...base, choice: 'manual' });
    expect(manual).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const current = await actions.chooseNextDateSourceAction({
      ...base,
      choice: 'current',
      date: '2026-12-01',
    });
    expect(current).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(graph.chooseNextDateSource).not.toHaveBeenCalled();
  });

  it('is FORBIDDEN for a viewer and maps a stale card to CONFLICT', async () => {
    state.role = 'viewer';
    expect(await actions.chooseNextDateSourceAction({ ...base, choice: 'current' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    state.role = 'owner';
    graph.chooseNextDateSource.mockRejectedValue(
      new WorkspaceError('CONFLICT', 'This date conflict was already resolved'),
    );
    expect(await actions.chooseNextDateSourceAction({ ...base, choice: 'current' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
  });
});
