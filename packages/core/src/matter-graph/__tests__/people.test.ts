// People services and the sensitive flag (#386, part 1 of #40) on the test database: contact
// details only for clients and professionals, workspace-only lookups, role edges to each target
// kind with events only for matter-scoped edges, and `setSensitive` / `updateMatter` gated by
// `matter.restrict`. Every name is fictional.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum, buildProceeding } from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  archiveMatter,
  createMatter,
  setRoleEdge,
  setSensitive,
  updateMatter,
  upsertPerson,
  WorkspaceError,
  type GraphEvent,
  type MatterGraphDeps,
} from '../../index.ts';
import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';

interface World {
  tx: Transaction;
  workspaceId: string;
  ownerId: string;
  forumId: string;
  events: GraphEvent[];
  deps: MatterGraphDeps;
  as: (userId: string) => { userId: string; workspaceId: string };
}

async function world(tx: Transaction): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const events: GraphEvent[] = [];
  return {
    tx,
    workspaceId,
    ownerId,
    forumId: forum.id,
    events,
    deps: { db: tx, events: { emit: (e) => events.push(e) } },
    as: (userId) => ({ userId, workspaceId }),
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

describe('upsertPerson', () => {
  it('creates and updates a person with deduplicated aliases', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      const created = await upsertPerson(w.deps, owner, {
        name: '  P. Ilango (fictional) ',
        kind: 'party',
        aliases: ['Ilango (fictional)', 'ilango (fictional)', 'P Ilango (fictional)'],
      });
      expect(created).toMatchObject({
        workspaceId: w.workspaceId,
        name: 'P. Ilango (fictional)',
        kind: 'party',
        aliases: ['Ilango (fictional)', 'P Ilango (fictional)'],
        contact: null,
        sourceType: 'manual',
      });
      const updated = await upsertPerson(w.deps, owner, {
        personId: created.id,
        name: 'P. Ilango (fictional)',
        kind: 'client',
        contact: { email: 'ilango@example.test' },
      });
      expect(updated).toMatchObject({
        id: created.id,
        kind: 'client',
        aliases: ['Ilango (fictional)', 'P Ilango (fictional)'],
        contact: { email: 'ilango@example.test' },
      });
      // `contact: undefined` keeps it; `null` clears it.
      const kept = await upsertPerson(w.deps, owner, {
        personId: created.id,
        name: 'P. Ilango (fictional)',
        kind: 'client',
        aliases: [],
      });
      expect(kept).toMatchObject({ aliases: [], contact: { email: 'ilango@example.test' } });
      expect(w.events).toEqual([]);
    });
  });

  it('rejects contact details on kinds other than client and professional', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      for (const kind of ['party', 'advocate', 'judge_staff', 'other'] as const) {
        expect(
          await codeOf(
            upsertPerson(w.deps, owner, {
              name: 'R. Nila (fictional)',
              kind,
              contact: { phone: '+91 00000 00000' },
            }),
          ),
          kind,
        ).toBe('VALIDATION');
      }
      for (const kind of ['client', 'professional'] as const) {
        const row = await upsertPerson(w.deps, owner, {
          name: 'R. Nila (fictional)',
          kind,
          contact: { phone: '+91 00000 00000' },
        });
        expect(row.contact).toEqual({ phone: '+91 00000 00000' });
      }
      const client = await upsertPerson(w.deps, owner, {
        name: 'S. Kathir (fictional)',
        kind: 'client',
        contact: { address: 'Chennai' },
      });
      // Turning a client into a party keeps no contact behind.
      expect(
        await codeOf(
          upsertPerson(w.deps, owner, {
            personId: client.id,
            name: 'S. Kathir (fictional)',
            kind: 'party',
          }),
        ),
      ).toBe('VALIDATION');
      const party = await upsertPerson(w.deps, owner, {
        personId: client.id,
        name: 'S. Kathir (fictional)',
        kind: 'party',
        contact: null,
      });
      expect(party).toMatchObject({ kind: 'party', contact: null });
    });
  });

  it('refuses readers, outsiders and persons of another workspace', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const other = await world(tx);
      const theirs = await upsertPerson(other.deps, other.as(other.ownerId), {
        name: 'Mullai Traders (fictional)',
        kind: 'party',
      });
      for (const role of ['viewer', 'clerk'] as const) {
        const userId = await addMember(tx, w.workspaceId, role);
        expect(
          await codeOf(
            upsertPerson(w.deps, w.as(userId), { name: 'X (fictional)', kind: 'party' }),
          ),
          role,
        ).toBe('FORBIDDEN');
      }
      expect(
        await codeOf(
          upsertPerson(w.deps, w.as(w.ownerId), {
            personId: theirs.id,
            name: 'Probe (fictional)',
            kind: 'party',
          }),
        ),
      ).toBe('NOT_FOUND');
      expect(
        await codeOf(
          upsertPerson(
            w.deps,
            { userId: w.ownerId, workspaceId: other.workspaceId },
            {
              name: 'Probe (fictional)',
              kind: 'party',
            },
          ),
        ),
      ).toBe('NOT_FOUND');
      const [unchanged] = await inWorkspace(tx, other.workspaceId, (s) =>
        s.select().from(schema.person).where(eq(schema.person.id, theirs.id)),
      );
      expect(unchanged?.name).toBe('Mullai Traders (fictional)');
    });
  });
});

describe('setRoleEdge', () => {
  it('sets each kind to each target, idempotently, and removes edges', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      const m = await createMatter(w.deps, owner, { title: 'People (fictional)', sensitive: true });
      const p = await inWorkspace(tx, w.workspaceId, (s) =>
        buildProceeding(s, w.workspaceId, { matterId: m.id, forumId: w.forumId }),
      );
      const advocate = await upsertPerson(w.deps, owner, {
        name: 'R. Nila (fictional)',
        kind: 'advocate',
      });
      const client = await upsertPerson(w.deps, owner, {
        name: 'P. Ilango (fictional)',
        kind: 'client',
      });
      w.events.length = 0;

      const kinds = [
        'represents',
        'appears_for',
        'instructed_by',
        'assigned_to',
        'opposes',
      ] as const;
      for (const kind of kinds) {
        const edge = await setRoleEdge(w.deps, owner, {
          kind,
          fromPersonId: advocate.id,
          matterId: m.id,
        });
        expect(edge).toMatchObject({ kind, matterId: m.id, toPersonId: null, proceedingId: null });
      }
      expect(w.events.map((e) => e.type)).toEqual(kinds.map(() => 'role_edge.set'));
      expect(w.events[0]).toMatchObject({ matterId: m.id, sensitive: true, personId: advocate.id });

      const onProceeding = await setRoleEdge(w.deps, owner, {
        kind: 'appears_for',
        fromPersonId: advocate.id,
        proceedingId: p.id,
      });
      expect(w.events.at(-1)).toMatchObject({ matterId: m.id, proceedingId: p.id });
      const again = await setRoleEdge(w.deps, owner, {
        kind: 'appears_for',
        fromPersonId: advocate.id,
        proceedingId: p.id,
      });
      expect(again?.id).toBe(onProceeding?.id);
      const count = w.events.length;

      // Person to person: no matter, no event.
      const instructed = await setRoleEdge(w.deps, owner, {
        kind: 'instructed_by',
        fromPersonId: advocate.id,
        toPersonId: client.id,
      });
      expect(instructed).toMatchObject({ toPersonId: client.id, matterId: null });
      expect(w.events).toHaveLength(count);

      const removed = await setRoleEdge(w.deps, owner, {
        kind: 'appears_for',
        fromPersonId: advocate.id,
        proceedingId: p.id,
        remove: true,
      });
      expect(removed?.id).toBe(onProceeding?.id);
      expect(w.events.at(-1)).toMatchObject({ type: 'role_edge.removed', proceedingId: p.id });
      expect(
        await setRoleEdge(w.deps, owner, {
          kind: 'appears_for',
          fromPersonId: advocate.id,
          proceedingId: p.id,
          remove: true,
        }),
      ).toBeNull();

      expect(
        await codeOf(
          setRoleEdge(w.deps, owner, {
            kind: 'opposes',
            fromPersonId: advocate.id,
            toPersonId: advocate.id,
          }),
        ),
      ).toBe('VALIDATION');
      expect(
        await codeOf(
          setRoleEdge(w.deps, owner, {
            kind: 'opposes',
            fromPersonId: advocate.id,
            matterId: m.id,
            proceedingId: p.id,
          }),
        ),
      ).toBe('VALIDATION');
    });
  });

  it('never reaches persons, matters or proceedings of another workspace', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const other = await world(tx);
      const owner = w.as(w.ownerId);
      const mine = await upsertPerson(w.deps, owner, {
        name: 'R. Nila (fictional)',
        kind: 'party',
      });
      const myMatter = await createMatter(w.deps, owner, { title: 'Mine (fictional)' });
      const theirOwner = other.as(other.ownerId);
      const theirPerson = await upsertPerson(other.deps, theirOwner, {
        name: 'Mullai Traders (fictional)',
        kind: 'party',
      });
      const theirMatter = await createMatter(other.deps, theirOwner, {
        title: 'Theirs (fictional)',
      });
      const theirProceeding = await inWorkspace(tx, other.workspaceId, (s) =>
        buildProceeding(s, other.workspaceId, { matterId: theirMatter.id, forumId: other.forumId }),
      );
      for (const target of [
        { matterId: theirMatter.id },
        { proceedingId: theirProceeding.id },
        { toPersonId: theirPerson.id },
      ]) {
        expect(
          await codeOf(
            setRoleEdge(w.deps, owner, { kind: 'opposes', fromPersonId: mine.id, ...target }),
          ),
        ).toBe('NOT_FOUND');
      }
      expect(
        await codeOf(
          setRoleEdge(w.deps, owner, {
            kind: 'opposes',
            fromPersonId: theirPerson.id,
            matterId: myMatter.id,
          }),
        ),
      ).toBe('NOT_FOUND');
      const edges = await inWorkspace(tx, other.workspaceId, (s) =>
        s.select().from(schema.roleEdge),
      );
      expect(edges).toEqual([]);
      expect(other.events.filter((e) => e.type.startsWith('role_edge'))).toEqual([]);
    });
  });

  it('needs matter.write on the matter', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      const m = await createMatter(w.deps, owner, { title: 'Scoped (fictional)' });
      const person = await upsertPerson(w.deps, owner, {
        name: 'R. Nila (fictional)',
        kind: 'party',
      });
      const clerk = await addMember(tx, w.workspaceId, 'clerk');
      const junior = await addMember(tx, w.workspaceId, 'junior');
      expect(
        await codeOf(
          setRoleEdge(w.deps, w.as(clerk), {
            kind: 'opposes',
            fromPersonId: person.id,
            matterId: m.id,
          }),
        ),
      ).toBe('FORBIDDEN');
      // A junior who is not on the matter cannot see it.
      expect(
        await codeOf(
          setRoleEdge(w.deps, w.as(junior), {
            kind: 'opposes',
            fromPersonId: person.id,
            matterId: m.id,
          }),
        ),
      ).toBe('NOT_FOUND');
      expect(
        await codeOf(
          setRoleEdge(w.deps, owner, {
            kind: 'opposes',
            fromPersonId: randomUUID(),
            matterId: m.id,
          }),
        ),
      ).toBe('NOT_FOUND');
    });
  });
});

describe('setSensitive', () => {
  it('lets owners and advocates toggle the flag, and no one else', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      const m = await createMatter(w.deps, owner, { title: 'Sensitive (fictional)' });
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      w.events.length = 0;

      const on = await setSensitive(w.deps, owner, { matterId: m.id, sensitive: true });
      expect(on.sensitive).toBe(true);
      expect(w.events).toEqual([
        {
          type: 'matter.updated',
          workspaceId: w.workspaceId,
          actorUserId: w.ownerId,
          matterId: m.id,
          sensitive: true,
          changed: ['sensitive'],
        },
      ]);
      await setSensitive(w.deps, owner, { matterId: m.id, sensitive: true });
      expect(w.events).toHaveLength(1);
      const off = await setSensitive(w.deps, w.as(advocate), { matterId: m.id, sensitive: false });
      expect(off.sensitive).toBe(false);

      for (const role of ['junior', 'clerk', 'viewer'] as const) {
        const userId = await addMember(tx, w.workspaceId, role);
        const code = await codeOf(
          setSensitive(w.deps, w.as(userId), { matterId: m.id, sensitive: true }),
        );
        // A junior not on the matter cannot see it at all.
        expect(code, role).toBe(role === 'junior' ? 'NOT_FOUND' : 'FORBIDDEN');
      }
      expect(
        await codeOf(setSensitive(w.deps, owner, { matterId: randomUUID(), sensitive: true })),
      ).toBe('NOT_FOUND');
      await archiveMatter(w.deps, owner, { matterId: m.id });
      expect(await codeOf(setSensitive(w.deps, owner, { matterId: m.id, sensitive: true }))).toBe(
        'CONFLICT',
      );
    });
  });

  it('gates a sensitive change in updateMatter too, but not a synopsis edit', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      const junior = await addMember(tx, w.workspaceId, 'junior');
      const [juniorMember] = await inWorkspace(tx, w.workspaceId, (s) =>
        s
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(eq(schema.member.userId, junior)),
      );
      const m = await createMatter(w.deps, owner, {
        title: 'Junior owns (fictional)',
        ownerMemberId: juniorMember?.id ?? null,
      });
      expect(
        await codeOf(
          updateMatter(w.deps, w.as(junior), { matterId: m.id, patch: { sensitive: true } }),
        ),
      ).toBe('FORBIDDEN');
      const edited = await updateMatter(w.deps, w.as(junior), {
        matterId: m.id,
        patch: { synopsis: 'Argue delay first.', sensitive: false },
      });
      expect(edited).toMatchObject({ synopsis: 'Argue delay first.', sensitive: false });
      const byOwner = await updateMatter(w.deps, owner, {
        matterId: m.id,
        patch: { sensitive: true },
      });
      expect(byOwner.sensitive).toBe(true);
    });
  });
});
