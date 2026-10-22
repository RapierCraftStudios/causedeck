// People tab server actions (#393). Each validates its input with zod, refuses a role below
// `matter.write` (clerks, viewers) with FORBIDDEN before core runs, passes the workspace-scoped
// transaction as `deps.db`, and maps a domain NOT_FOUND or VALIDATION from core to the same code.
// `upsertPersonAction` sets a new person's role on the matter in the same transaction, only edits
// a person who has a role on this matter, and never returns contact details; `setRoleEdgeAction`
// sets or removes a role on this matter. Every name is fictional.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const MATTER = '00000000-0000-4000-8000-0000000c0001';
const PERSON = '00000000-0000-4000-8000-0000000e0001';
const EDGE = '00000000-0000-4000-8000-0000000f0001';
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
  upsertPerson: vi.fn(),
  setRoleEdge: vi.fn(),
  listMatterPeople: vi.fn(),
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

const actions = await import('../app/(app)/w/[slug]/matters/[id]/people/actions.ts');

class WorkspaceError extends Error {
  override name = 'WorkspaceError';
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

const personRow = {
  id: PERSON,
  name: 'K. Rao (fictional)',
  kind: 'client',
  aliases: ['Rao K.'],
  contact: { phone: '98400 00000' },
  workspaceId: WS,
};

const peopleOfMatter = [
  {
    kind: 'represents',
    edges: [
      {
        edgeId: EDGE,
        proceedingId: null,
        person: { id: PERSON, name: personRow.name, aliases: [], kind: 'client', contact: null },
        provenance: { sourceType: 'manual', confirmationState: 'confirmed' },
      },
    ],
  },
];

beforeEach(() => {
  state.session = {
    session: { id: 'session-1' },
    user: { id: USER, name: 'Asha', email: 'a@x.test', twoFactorEnabled: true },
  } as unknown as AppSession;
  state.role = 'owner';
  graph.upsertPerson.mockResolvedValue(personRow);
  graph.setRoleEdge.mockResolvedValue({ id: EDGE });
  graph.listMatterPeople.mockResolvedValue(peopleOfMatter);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('upsertPersonAction (#393)', () => {
  it.each(['owner', 'advocate', 'junior'])(
    'adds a person and their role on the matter in one transaction for a %s',
    async (role) => {
      state.role = role;
      const result = await actions.upsertPersonAction({
        workspaceId: WS,
        matterId: MATTER,
        person: {
          name: '  K. Rao (fictional) ',
          aliases: ['Rao K.'],
          kind: 'client',
          contact: { phone: '98400 00000' },
        },
        role: { kind: 'represents' },
      });
      // The contact is never sent back.
      expect(result).toEqual({
        ok: true,
        data: { id: PERSON, name: personRow.name, kind: 'client', aliases: ['Rao K.'] },
      });
      const actor = { workspaceId: WS, userId: USER };
      expect(graph.upsertPerson).toHaveBeenCalledWith(expect.objectContaining({ db: TX }), actor, {
        name: 'K. Rao (fictional)',
        kind: 'client',
        aliases: ['Rao K.'],
        contact: { phone: '98400 00000' },
      });
      expect(graph.setRoleEdge).toHaveBeenCalledWith(expect.objectContaining({ db: TX }), actor, {
        kind: 'represents',
        fromPersonId: PERSON,
        matterId: MATTER,
      });
      // One workspace transaction for both writes.
      expect(runtime.inWorkspace).toHaveBeenCalledTimes(1);
      expect(graph.listMatterPeople).not.toHaveBeenCalled();
      expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/matters/[id]', 'layout');
    },
  );

  it('edits a person of this matter; null clears the contact', async () => {
    const result = await actions.upsertPersonAction({
      workspaceId: WS,
      matterId: MATTER,
      person: { personId: PERSON, name: 'K. Rao', kind: 'party', contact: null },
    });
    expect(result.ok).toBe(true);
    expect(graph.listMatterPeople).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      { matterId: MATTER },
    );
    expect(graph.upsertPerson).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      personId: PERSON,
      name: 'K. Rao',
      kind: 'party',
      contact: null,
    });
    expect(graph.setRoleEdge).not.toHaveBeenCalled();
  });

  it('refuses to edit a person who has no role on this matter', async () => {
    graph.listMatterPeople.mockResolvedValue([{ kind: 'represents', edges: [] }]);
    const result = await actions.upsertPersonAction({
      workspaceId: WS,
      matterId: MATTER,
      person: { personId: PERSON, name: 'K. Rao', kind: 'party' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(graph.upsertPerson).not.toHaveBeenCalled();
  });

  it.each(['clerk', 'viewer'])('is FORBIDDEN for a %s before core runs', async (role) => {
    state.role = role;
    const result = await actions.upsertPersonAction({
      workspaceId: WS,
      matterId: MATTER,
      person: { name: 'K. Rao', kind: 'party' },
      role: { kind: 'opposes' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(graph.upsertPerson).not.toHaveBeenCalled();
    expect(graph.setRoleEdge).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank name', { name: '  ', kind: 'party' }],
    ['an unknown kind', { name: 'K. Rao', kind: 'stranger' }],
    ['a malformed email', { name: 'K. Rao', kind: 'client', contact: { email: 'nope' } }],
    ['an unknown key', { name: 'K. Rao', kind: 'party', importedFrom: 'phone' }],
  ])('rejects %s with VALIDATION', async (_label, person) => {
    const result = await actions.upsertPersonAction({ workspaceId: WS, matterId: MATTER, person });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(graph.upsertPerson).not.toHaveBeenCalled();
  });

  it('maps a domain error from core to its code', async () => {
    graph.setRoleEdge.mockRejectedValue(new WorkspaceError('NOT_FOUND', 'Matter not found'));
    const result = await actions.upsertPersonAction({
      workspaceId: WS,
      matterId: MATTER,
      person: { name: 'K. Rao', kind: 'party' },
      role: { kind: 'opposes' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    graph.upsertPerson.mockRejectedValue(
      new WorkspaceError('VALIDATION', 'contact: Contact details are kept only for clients'),
    );
    const invalid = await actions.upsertPersonAction({
      workspaceId: WS,
      matterId: MATTER,
      person: { name: 'K. Rao', kind: 'party' },
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('setRoleEdgeAction (#393)', () => {
  it('sets a role on the matter', async () => {
    const result = await actions.setRoleEdgeAction({
      workspaceId: WS,
      matterId: MATTER,
      personId: PERSON,
      kind: 'instructed_by',
    });
    expect(result).toEqual({ ok: true, data: { edgeId: EDGE } });
    expect(graph.setRoleEdge).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX }),
      { workspaceId: WS, userId: USER },
      { kind: 'instructed_by', fromPersonId: PERSON, matterId: MATTER },
    );
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/matters/[id]', 'layout');
  });

  it('removes a role on the matter', async () => {
    const result = await actions.setRoleEdgeAction({
      workspaceId: WS,
      matterId: MATTER,
      personId: PERSON,
      kind: 'represents',
      remove: true,
    });
    expect(result).toEqual({ ok: true, data: { removed: true } });
    expect(graph.setRoleEdge).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      kind: 'represents',
      fromPersonId: PERSON,
      matterId: MATTER,
      remove: true,
    });
  });

  it('is FORBIDDEN for a viewer and rejects a bad kind', async () => {
    state.role = 'viewer';
    const forbidden = await actions.setRoleEdgeAction({
      workspaceId: WS,
      matterId: MATTER,
      personId: PERSON,
      kind: 'represents',
    });
    expect(forbidden).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    state.role = 'owner';
    const invalid = await actions.setRoleEdgeAction({
      workspaceId: WS,
      matterId: MATTER,
      personId: 'not-a-uuid',
      kind: 'friend_of',
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(graph.setRoleEdge).not.toHaveBeenCalled();
  });
});
