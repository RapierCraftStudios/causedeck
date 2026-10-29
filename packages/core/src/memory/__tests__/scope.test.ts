// Scope in SQL (#72): R3 matter scope, R4 M4 privacy and chamber sharing, R5 clerk denial. Each
// case checks both the service and the database underneath it: the RLS scope policies answer for a
// query that forgot its predicate, and the clerk role has no privilege on the base tables.
import { schema, withWorkspace } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  canReadMemory,
  createMemoryNote,
  deleteMemory,
  editMemory,
  exportMemory,
  getMemory,
  listMemory,
  memoryFor,
  setSharedWithChamber,
  type MemoryActor,
} from '../index.ts';
import { withMatterScope } from '../scope.ts';

import { codeOf, inWorld, type World } from '../../__tests__/memory-world.ts';

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

async function note(w: World, actor: MemoryActor, input: Record<string, unknown>) {
  return createMemoryNote(w.deps, actor, input);
}

describe('R3: a matter-scoped item is returned only for its own matter', () => {
  it('returns M3 for its matter and nothing for another matter or no matter', async () => {
    await inWorld(async (w) => {
      const one = await note(w, w.owner, {
        key: 'M3.synopsis',
        value: 'writ against the registrar',
        scope: 'matter',
        matterId: w.m1,
      });
      const two = await note(w, w.owner, {
        key: 'M3.synopsis',
        value: 'a different matter',
        scope: 'matter',
        matterId: w.m2,
      });
      const read = async (matterId?: string) =>
        ids(
          (await memoryFor(w.deps, w.owner, { matterId, layers: ['M3'], purpose: 'brief' })).items,
        );
      expect(await read(w.m1)).toEqual([one.id]);
      expect(await read(w.m2)).toEqual([two.id]);
      expect(await read()).toEqual([]);

      // By id: another matter's id, or none, finds nothing.
      expect((await getMemory(w.deps, w.owner, one.id, { matterId: w.m1 })).item.id).toBe(one.id);
      expect(await codeOf(getMemory(w.deps, w.owner, one.id, { matterId: w.m2 }))).toBe(
        'NOT_FOUND',
      );
      expect(await codeOf(getMemory(w.deps, w.owner, one.id))).toBe('NOT_FOUND');
      // A listing and a mutation are scoped the same way.
      expect(ids(await listMemory(w.deps, w.owner, { matterId: w.m2 }))).not.toContain(one.id);
      expect(
        await codeOf(editMemory(w.deps, w.owner, one.id, { value: 'x' }, { matterId: w.m2 })),
      ).toBe('NOT_FOUND');
      expect(await codeOf(deleteMemory(w.deps, w.owner, one.id, { matterId: w.m2 }))).toBe(
        'NOT_FOUND',
      );
      // An export is not an output: it carries both.
      expect(ids(await exportMemory(w.deps, w.owner))).toEqual(
        expect.arrayContaining([one.id, two.id]),
      );
    });
  });

  it('the RLS policy alone hides another matter, with no predicate in the query', async () => {
    await inWorld(async (w) => {
      const one = await note(w, w.owner, {
        key: 'M3.synopsis',
        value: 'matter one only',
        scope: 'matter',
        matterId: w.m1,
      });
      const bare = (matterId: string | null) =>
        inWorkspace(
          w.tx,
          w.a.id,
          (s) =>
            withMatterScope(s, matterId, async () => {
              const rows = await s.execute<{ id: string }>(
                sql`select id::text from memory_item where id = ${one.id}::uuid`,
              );
              return rows.length;
            }),
          w.ua,
        );
      expect(await bare(w.m1)).toBe(1);
      expect(await bare(w.m2)).toBe(0);
      // A write for another matter than the pinned one is refused too.
      await expect(
        inWorkspace(
          w.tx,
          w.a.id,
          (s) =>
            withMatterScope(s, w.m2, () =>
              s.transaction((inner) =>
                inner.insert(schema.memoryItem).values({
                  workspaceId: w.a.id,
                  layer: 'M3',
                  key: 'M3.synopsis',
                  scope: 'matter',
                  matterId: w.m1,
                  ownerUserId: w.ua,
                  valueCiphertext: 'x',
                  sourceType: 'manual',
                  confirmationState: 'confirmed',
                }),
              ),
            ),
          w.ua,
        ),
      ).rejects.toThrow();
    });
  });

  it('canReadMemory states the same rule for a row in hand', () => {
    const m3 = {
      layer: 'M3',
      key: 'M3.synopsis',
      scope: 'matter',
      matterId: 'matter-1',
      ownerUserId: 'u1',
      sharedWithChamber: false,
      strategy: false,
    } as const;
    expect(canReadMemory('owner', 'u1', m3, 'matter-1')).toBe(true);
    expect(canReadMemory('owner', 'u1', m3, 'matter-2')).toBe(false);
    expect(canReadMemory('owner', 'u1', m3, null)).toBe(false);
    expect(canReadMemory('viewer', 'u1', m3, 'matter-1')).toBe(false);
    expect(canReadMemory('clerk', 'u1', m3, 'matter-1')).toBe(false);
  });
});

describe('R4: M4 court notes are private to the author', () => {
  const hall = { key: 'M4.hall_note', value: 'Hall 4 starts at 10:30', scope: 'user' };

  it('hides a note from every other member until an owner shares it, and audits the change', async () => {
    await inWorld(async (w) => {
      const mine = await note(w, w.owner, hall);
      const readBy = async (actor: MemoryActor) =>
        ids((await memoryFor(w.deps, actor, { layers: ['M4'], purpose: 'brief' })).items);
      expect(await readBy(w.owner)).toEqual([mine.id]);
      expect(await readBy(w.advocate)).toEqual([]);
      expect(await readBy(w.asJunior)).toEqual([]);
      expect(await codeOf(getMemory(w.deps, w.advocate, mine.id))).toBe('NOT_FOUND');
      // RLS under a query without a predicate: the advocate's scope sees no row.
      const rawCount = await inWorkspace(
        w.tx,
        w.a.id,
        async (s) =>
          (await s.select().from(schema.memoryItem).where(eq(schema.memoryItem.id, mine.id)))
            .length,
        w.uboth,
      );
      expect(rawCount).toBe(0);

      // Non-owners cannot flip it: not an advocate, not a junior; sharing needs the owner role.
      expect(await codeOf(setSharedWithChamber(w.deps, w.advocate, mine.id, true))).toBe(
        'FORBIDDEN',
      );
      expect(await codeOf(setSharedWithChamber(w.deps, w.asJunior, mine.id, true))).toBe(
        'FORBIDDEN',
      );
      expect(await readBy(w.advocate)).toEqual([]);

      await setSharedWithChamber(w.deps, w.owner, mine.id, true);
      expect(await readBy(w.advocate)).toEqual([mine.id]);
      // Sharing lets the chamber read, not change.
      expect(await codeOf(editMemory(w.deps, w.advocate, mine.id, { value: 'x' }))).toBe(
        'FORBIDDEN',
      );
      expect(await codeOf(deleteMemory(w.deps, w.advocate, mine.id))).toBe('FORBIDDEN');

      const events = await inWorkspace(w.tx, w.a.id, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.action, 'memory.sharing_changed'),
              eq(schema.auditEvent.targetId, mine.id),
            ),
          ),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.actorUserId).toBe(w.ua);
      expect(JSON.stringify(events[0]?.metadata)).not.toContain('Hall 4');

      await setSharedWithChamber(w.deps, w.owner, mine.id, false);
      expect(await readBy(w.advocate)).toEqual([]);
    });
  });

  it('an advocate’s note stays private even from an owner, and only M4 can be shared', async () => {
    await inWorld(async (w) => {
      const theirs = await note(w, w.advocate, hall);
      expect(await codeOf(getMemory(w.deps, w.owner, theirs.id))).toBe('NOT_FOUND');
      expect(await codeOf(setSharedWithChamber(w.deps, w.owner, theirs.id, true))).toBe(
        'NOT_FOUND',
      );
      const pref = await note(w, w.owner, { key: 'M2.brief_format', value: 'x', scope: 'user' });
      expect(await codeOf(setSharedWithChamber(w.deps, w.owner, pref.id, true))).toBe('VALIDATION');
      // The table refuses a shared flag on any other layer, whoever writes it.
      await expect(
        inWorkspace(w.tx, w.a.id, (s) =>
          s.transaction((inner) =>
            inner
              .update(schema.memoryItem)
              .set({ sharedWithChamber: true })
              .where(eq(schema.memoryItem.id, pref.id)),
          ),
        ),
      ).rejects.toThrow();
    });
  });
});

describe('R5: clerks read no M3, M4 or strategy values', () => {
  it('returns only non-strategy M1, M2, M6 and M7 through the view, layer by layer', async () => {
    await inWorld(async (w) => {
      const make = (key: string, extra: Record<string, unknown> = {}) =>
        note(w, w.owner, { key, value: `value of ${key}`, scope: 'workspace', ...extra });
      const m1 = await make('M1.courts');
      const m1s = await make('M1.approach');
      const m2 = await make('M2.brief_format');
      const m2s = await make('M2.settlement_posture');
      const m6 = await make('M6.client_language', { personId: w.client });
      const m7 = await make('M7.party_alias');
      const m3 = await note(w, w.owner, {
        key: 'M3.synopsis',
        value: 'synopsis',
        scope: 'matter',
        matterId: w.m1,
      });
      const m4 = await note(w, w.owner, { key: 'M4.hall_note', value: 'hall', scope: 'user' });
      await setSharedWithChamber(w.deps, w.owner, m4.id, true);

      const forLayer = async (layer: 'M1' | 'M2' | 'M3' | 'M4' | 'M6' | 'M7', matterId?: string) =>
        ids(
          (await memoryFor(w.deps, w.asClerk, { matterId, layers: [layer], purpose: 'matching' }))
            .items,
        );
      expect(await forLayer('M1')).toEqual([m1.id]);
      expect(await forLayer('M2')).toEqual([m2.id]);
      expect(await forLayer('M6')).toEqual([m6.id]);
      expect(await forLayer('M7')).toEqual([m7.id]);
      expect(await forLayer('M3', w.m1)).toEqual([]);
      expect(await forLayer('M4')).toEqual([]);
      expect(ids(await listMemory(w.deps, w.asClerk)).sort()).toEqual(
        [m1.id, m2.id, m6.id, m7.id].sort(),
      );
      expect(ids(await exportMemory(w.deps, w.asClerk)).sort()).toEqual(
        [m1.id, m2.id, m6.id, m7.id].sort(),
      );
      for (const hidden of [m1s, m2s, m3, m4]) {
        expect(await codeOf(getMemory(w.deps, w.asClerk, hidden.id, { matterId: w.m1 }))).toBe(
          'NOT_FOUND',
        );
      }
      // The same items are readable by the lawyer.
      expect((await getMemory(w.deps, w.owner, m1s.id)).item.key).toBe('M1.approach');
      expect((await getMemory(w.deps, w.advocate, m2s.id)).item.key).toBe('M2.settlement_posture');
    });
  });

  it('the clerk role has no privilege on the base tables, and its view holds no hidden row', async () => {
    await inWorld(async (w) => {
      const strategy = await note(w, w.owner, {
        key: 'M2.settlement_posture',
        value: 'strategy',
        scope: 'workspace',
      });
      const m3 = await note(w, w.owner, {
        key: 'M3.synopsis',
        value: 'synopsis',
        scope: 'matter',
        matterId: w.m1,
      });
      const open = await note(w, w.owner, {
        key: 'M2.brief_format',
        value: 'x',
        scope: 'workspace',
      });
      const asClerkRole = <T>(fn: (s: typeof w.tx) => Promise<T>) =>
        withWorkspace(w.tx, { workspaceId: w.a.id, userId: w.clerk, dbRole: 'clerk' }, fn);
      const view = await asClerkRole(
        async (s) =>
          await s.execute<{ id: string; layer: string }>(
            sql`select id::text, layer from memory_item_clerk_v`,
          ),
      );
      expect(view.map((r) => r.id)).toContain(open.id);
      expect(view.map((r) => r.id)).not.toContain(strategy.id);
      expect(view.map((r) => r.id)).not.toContain(m3.id);
      expect(view.every((r) => ['M1', 'M2', 'M6', 'M7'].includes(r.layer))).toBe(true);
      for (const table of ['memory_item', 'memory_proposal', 'memory_embedding']) {
        await expect(
          asClerkRole((s) =>
            s.transaction((inner) => inner.execute(sql.raw(`select count(*) from ${table}`))),
          ),
          table,
        ).rejects.toThrow();
      }
    });
  });

  it('a viewer reads no memory', async () => {
    await inWorld(async (w) => {
      const item = await note(w, w.owner, { key: 'M1.courts', value: 'x', scope: 'workspace' });
      expect(await listMemory(w.deps, w.asViewer)).toEqual([]);
      expect(await exportMemory(w.deps, w.asViewer)).toEqual([]);
      expect(
        (await memoryFor(w.deps, w.asViewer, { layers: ['M1'], purpose: 'brief' })).items,
      ).toEqual([]);
      expect(await codeOf(getMemory(w.deps, w.asViewer, item.id))).toBe('NOT_FOUND');
    });
  });
});
