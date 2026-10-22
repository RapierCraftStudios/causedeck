// Proceedings tab server actions (#392). Each validates its input with zod, refuses a role below
// `matter.write` (`matter.read` for the duplicate lookup) with FORBIDDEN before core runs, passes
// the workspace-scoped transaction as `deps.db`, never forwards a client provenance (a person typed
// it: `manual`), returns `{ok: true, data}` of the documented shape and maps the matter-graph's
// typed errors (`CrossWorkspaceError` NOT_FOUND, `InvalidTransitionError` CONFLICT) to the same
// code, never INTERNAL. Merges and splits return their `UndoPayload`; the undo actions validate it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const MATTER = '00000000-0000-4000-8000-0000000c0001';
const OTHER = '00000000-0000-4000-8000-0000000c0002';
const FORUM = '00000000-0000-4000-8000-0000000f0001';
const P1 = '00000000-0000-4000-8000-0000000e0001';
const P2 = '00000000-0000-4000-8000-0000000e0002';
const TX = { scoped: true };
const AT = '2026-10-21 10:00:00.123456+00';

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
  createProceeding: vi.fn(),
  updateIdentifiers: vi.fn(),
  linkProceedings: vi.fn(),
  transitionProceeding: vi.fn(),
  findDuplicateProceedings: vi.fn(),
  previewMergeMatters: vi.fn(),
  previewSplitMatter: vi.fn(),
  mergeMatters: vi.fn(),
  undoMerge: vi.fn(),
  splitMatter: vi.fn(),
  undoSplit: vi.fn(),
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

const actions = await import('../app/(app)/w/[slug]/matters/[id]/proceedings/actions.ts');

/** The matter-graph errors as core throws them: subclasses with their own names. */
class GraphError extends Error {
  constructor(
    override readonly name: string,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

const proceedingRow = (overrides: Record<string, unknown> = {}) => ({
  id: P1,
  matterId: MATTER,
  state: 'filed',
  caseTypeRaw: 'W.P.',
  caseTypeCode: 'WP',
  number: '12345',
  year: 2026,
  titlePetitioner: 'secret party',
  ...overrides,
});

const mergePayload = {
  op: 'matter.merge',
  version: 1,
  before: {
    intoMatterId: MATTER,
    fromMatterId: OTHER,
    fromMatter: { mergedIntoMatterId: null, updatedAt: AT },
    rows: {
      proceeding: [{ id: P2, updatedAt: AT }],
      document: [],
      roleEdge: [],
      obligation: [],
      task: [],
      mergedMatter: [],
    },
    links: [],
  },
  after: { intoMatterId: MATTER },
};

const splitPayload = {
  op: 'matter.split',
  version: 1,
  before: {
    matterId: MATTER,
    rows: { proceeding: [{ id: P2, updatedAt: AT }], obligation: [], task: [] },
  },
  after: { newMatterId: OTHER },
};

beforeEach(() => {
  state.session = {
    session: { id: 'session-1' },
    user: { id: USER, name: 'Asha', email: 'a@x.test', twoFactorEnabled: true },
  } as unknown as AppSession;
  state.role = 'owner';
  graph.createProceeding.mockResolvedValue(proceedingRow());
  graph.updateIdentifiers.mockResolvedValue(proceedingRow({ number: '999' }));
  graph.linkProceedings.mockResolvedValue({ id: 'link-1', kind: 'connected' });
  graph.transitionProceeding.mockResolvedValue({
    proceeding: proceedingRow({ state: 'sr_fr' }),
    stateChange: { id: 'sc-1' },
  });
  graph.findDuplicateProceedings.mockResolvedValue([
    proceedingRow({ id: P2, matterId: OTHER, cnr: null }),
  ]);
  graph.previewMergeMatters.mockResolvedValue({
    proceedings: [{ id: P2, caseType: 'WP', number: '1', year: 2026 }],
    documentIds: ['d1', 'd2'],
    obligationIds: ['o1'],
    intoSensitive: false,
    fromSensitive: true,
    blocked: 'sensitive',
  });
  graph.previewSplitMatter.mockResolvedValue({
    proceedings: [{ id: P2, caseType: 'WP', number: '1', year: 2026 }],
    obligationIds: ['o1', 'o2'],
    crossingLinks: 1,
    blocked: null,
  });
  graph.mergeMatters.mockResolvedValue({
    matter: { id: MATTER },
    from: { id: OTHER },
    undo: mergePayload,
    moved: {},
  });
  graph.undoMerge.mockResolvedValue({ matter: { id: OTHER } });
  graph.splitMatter.mockResolvedValue({
    matter: { id: OTHER },
    undo: splitPayload,
    moved: {},
    crossing: [{}, {}],
  });
  graph.undoSplit.mockResolvedValue({ matter: { id: MATTER } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createProceedingAction and updateProceedingAction (#392)', () => {
  it('creates with manual provenance on the scoped transaction and returns no party data', async () => {
    const result = await actions.createProceedingAction({
      workspaceId: WS,
      matterId: MATTER,
      forumId: FORUM,
      caseType: 'W.P.',
      number: '12345',
      year: 2026,
      parentProceedingId: P2,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        id: P1,
        matterId: MATTER,
        state: 'filed',
        caseType: 'W.P.',
        number: '12345',
        year: 2026,
      },
    });
    expect(graph.createProceeding).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      {
        matterId: MATTER,
        forumId: FORUM,
        caseType: 'W.P.',
        number: '12345',
        year: 2026,
        parentProceedingId: P2,
        provenance: { sourceType: 'manual' },
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/matters/[id]', 'layout');
  });

  it('never takes a provenance from the client, and rejects a blank case type', async () => {
    const withProvenance = await actions.createProceedingAction({
      workspaceId: WS,
      matterId: MATTER,
      forumId: FORUM,
      caseType: 'WP',
      provenance: { sourceType: 'ai', confirmationState: 'confirmed' },
    });
    expect(withProvenance.ok).toBe(true);
    expect(graph.createProceeding).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ provenance: { sourceType: 'manual' } }),
    );
    const blank = await actions.createProceedingAction({
      workspaceId: WS,
      matterId: MATTER,
      forumId: FORUM,
      caseType: ' ',
    });
    expect(blank).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('updates the identifiers through updateIdentifiers', async () => {
    const result = await actions.updateProceedingAction({
      workspaceId: WS,
      proceedingId: P1,
      number: '999',
      cnr: null,
    });
    expect(result).toMatchObject({ ok: true, data: { id: P1, number: '999' } });
    expect(graph.updateIdentifiers).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      { proceedingId: P1, number: '999', cnr: null },
    );
  });

  it.each(['viewer', 'clerk'])('refuses a %s before core runs', async (role) => {
    state.role = role;
    const result = await actions.createProceedingAction({
      workspaceId: WS,
      matterId: MATTER,
      forumId: FORUM,
      caseType: 'WP',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(graph.createProceeding).not.toHaveBeenCalled();
  });
});

describe('transitionProceedingAction and linkProceedingsAction (#392)', () => {
  it('moves the state with only the fields given', async () => {
    const result = await actions.transitionProceedingAction({
      workspaceId: WS,
      proceedingId: P1,
      to: 'numbered',
      number: '77',
      year: 2026,
    });
    expect(result).toMatchObject({ ok: true, data: { id: P1, state: 'sr_fr' } });
    expect(graph.transitionProceeding).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      { proceedingId: P1, to: 'numbered', number: '77', year: 2026 },
    );
  });

  it('maps an illegal move to CONFLICT and another workspace’s proceeding to NOT_FOUND', async () => {
    graph.transitionProceeding.mockRejectedValueOnce(
      new GraphError('InvalidTransitionError', 'CONFLICT', 'A proceeding cannot move'),
    );
    expect(
      await actions.transitionProceedingAction({
        workspaceId: WS,
        proceedingId: P1,
        to: 'disposed',
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    graph.linkProceedings.mockRejectedValueOnce(
      new GraphError('CrossWorkspaceError', 'NOT_FOUND', 'Not found in this workspace'),
    );
    expect(
      await actions.linkProceedingsAction({
        workspaceId: WS,
        fromProceedingId: P1,
        toProceedingId: P2,
        kind: 'appeal_from',
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('rejects an unknown state or link kind, and links with manual provenance', async () => {
    expect(
      await actions.transitionProceedingAction({ workspaceId: WS, proceedingId: P1, to: 'won' }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(
      await actions.linkProceedingsAction({
        workspaceId: WS,
        fromProceedingId: P1,
        toProceedingId: P2,
        kind: 'sibling',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    await actions.linkProceedingsAction({
      workspaceId: WS,
      fromProceedingId: P1,
      toProceedingId: P2,
      kind: 'connected',
    });
    expect(graph.linkProceedings).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      fromProceedingId: P1,
      toProceedingId: P2,
      kind: 'connected',
      provenance: { sourceType: 'manual' },
    });
  });
});

describe('findDuplicateProceedingsAction (#392)', () => {
  it('returns identifiers only, marks the same matter, and is open to readers', async () => {
    state.role = 'viewer';
    const result = await actions.findDuplicateProceedingsAction({
      workspaceId: WS,
      matterId: MATTER,
      identity: { caseType: 'W.P.', number: '12345', year: 2026 },
      excludeProceedingId: P1,
    });
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: P2,
          matterId: OTHER,
          sameMatter: false,
          caseType: 'W.P.',
          number: '12345',
          year: 2026,
          cnr: null,
        },
      ],
    });
    expect(graph.findDuplicateProceedings).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      {
        identity: { caseType: 'W.P.', number: '12345', year: 2026 },
        excludeProceedingId: P1,
        limit: 5,
      },
    );
  });
});

describe('merge and split actions (#392)', () => {
  it('previews a merge as counts with the refusal reason', async () => {
    const result = await actions.previewMergeAction({
      workspaceId: WS,
      intoMatterId: MATTER,
      fromMatterId: OTHER,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        proceedings: [{ id: P2, caseType: 'WP', number: '1', year: 2026 }],
        documents: 2,
        obligations: 1,
        crossingLinks: 0,
        intoSensitive: false,
        fromSensitive: true,
        blocked: 'sensitive',
      },
    });
  });

  it('previews a split', async () => {
    const result = await actions.previewSplitAction({
      workspaceId: WS,
      matterId: MATTER,
      proceedingIds: [P2],
    });
    expect(result).toMatchObject({
      ok: true,
      data: { obligations: 2, crossingLinks: 1, blocked: null },
    });
    expect(graph.previewSplitMatter).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      matterId: MATTER,
      proceedingIds: [P2],
    });
  });

  it('merges and returns the undo payload; the undo takes it back', async () => {
    const merged = await actions.mergeMattersAction({
      workspaceId: WS,
      intoMatterId: MATTER,
      fromMatterId: OTHER,
    });
    expect(merged).toEqual({
      ok: true,
      data: { matterId: MATTER, fromMatterId: OTHER, undo: mergePayload },
    });
    const undone = await actions.undoMergeAction({ workspaceId: WS, payload: mergePayload });
    expect(undone).toEqual({ ok: true, data: { matterId: OTHER } });
    expect(graph.undoMerge).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      { payload: mergePayload },
    );
  });

  it('refuses a malformed or mismatched undo payload before core runs', async () => {
    for (const payload of [{ ...mergePayload, version: 2 }, splitPayload, { op: 'x' }]) {
      const result = await actions.undoMergeAction({ workspaceId: WS, payload });
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    }
    expect(graph.undoMerge).not.toHaveBeenCalled();
    graph.undoMerge.mockRejectedValueOnce(new GraphError('WorkspaceError', 'CONFLICT', 'changed'));
    expect(await actions.undoMergeAction({ workspaceId: WS, payload: mergePayload })).toMatchObject(
      {
        ok: false,
        error: { code: 'CONFLICT' },
      },
    );
  });

  it('splits into a new matter with its href, and undoes it', async () => {
    const split = await actions.splitMatterAction({
      workspaceId: WS,
      slug: 'rao chambers',
      matterId: MATTER,
      proceedingIds: [P2],
      newTitle: '  Writ appeal ',
    });
    expect(split).toEqual({
      ok: true,
      data: {
        newMatterId: OTHER,
        newMatterHref: `/w/rao%20chambers/matters/${OTHER}`,
        undo: splitPayload,
        crossing: 2,
      },
    });
    expect(graph.splitMatter).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      matterId: MATTER,
      proceedingIds: [P2],
      newTitle: 'Writ appeal',
    });
    expect(await actions.undoSplitAction({ workspaceId: WS, payload: splitPayload })).toEqual({
      ok: true,
      data: { matterId: MATTER },
    });
  });

  it.each(['viewer', 'clerk'])('refuses a %s every merge and split call', async (role) => {
    state.role = role;
    for (const call of [
      () =>
        actions.previewMergeAction({ workspaceId: WS, intoMatterId: MATTER, fromMatterId: OTHER }),
      () =>
        actions.mergeMattersAction({ workspaceId: WS, intoMatterId: MATTER, fromMatterId: OTHER }),
      () => actions.undoMergeAction({ workspaceId: WS, payload: mergePayload }),
      () => actions.previewSplitAction({ workspaceId: WS, matterId: MATTER, proceedingIds: [P2] }),
      () =>
        actions.splitMatterAction({
          workspaceId: WS,
          slug: 's',
          matterId: MATTER,
          proceedingIds: [P2],
          newTitle: 'T',
        }),
      () => actions.undoSplitAction({ workspaceId: WS, payload: splitPayload }),
    ]) {
      expect(await call()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(graph.mergeMatters).not.toHaveBeenCalled();
    expect(graph.splitMatter).not.toHaveBeenCalled();
  });
});
