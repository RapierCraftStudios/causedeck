// Cross-tenant memory services (#72, R15): user `ub`, working in workspace B, names workspace A.
// Every call is refused (NOT_FOUND) or yields nothing, and A's memory rows are unchanged. A user who
// belongs to both workspaces (`uboth`) works in each without one leaking into the other. Driven by
// the same registry as services.test.ts, so a registered service without a case fails.
import { randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import { SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';
import { codeOf, inWorld, type World } from '../memory-world.ts';

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/memory.test.ts';

interface Fixture extends World {
  itemA: string;
  proposalA: string;
  m3A: string;
}

type Case = (f: Fixture) => Promise<void>;

const asBInA = (f: Fixture) => ({ userId: f.ub, workspaceId: f.a.id });

async function aState(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, async (s) => ({
    items: await s.select().from(schema.memoryItem).orderBy(schema.memoryItem.id),
    proposals: await s.select().from(schema.memoryProposal).orderBy(schema.memoryProposal.id),
    usage: await s.select().from(schema.memoryUsage).orderBy(schema.memoryUsage.id),
    pauses: await s.select().from(schema.memoryPause).orderBy(schema.memoryPause.id),
    embeddings: await s
      .select({ id: schema.memoryEmbedding.id, itemId: schema.memoryEmbedding.itemId })
      .from(schema.memoryEmbedding)
      .orderBy(schema.memoryEmbedding.id),
  }));
}

/** B's call is refused as NOT_FOUND and A's memory is exactly as it was. */
async function denied(f: Fixture, call: () => Promise<unknown>): Promise<void> {
  const before = await aState(f);
  expect(await codeOf(call())).toBe('NOT_FOUND');
  expect(await aState(f)).toEqual(before);
}

const note = { key: 'M2.brief_format', value: 'one page', scope: 'user' };

const CASES: Record<string, Case> = {
  acceptMemoryDraft: (f) => denied(f, () => core.acceptMemoryDraft(f.deps, asBInA(f), note)),
  confirmMemory: (f) => denied(f, () => core.confirmMemory(f.deps, asBInA(f), f.proposalA)),
  createMemoryNote: (f) => denied(f, () => core.createMemoryNote(f.deps, asBInA(f), note)),
  deleteMemory: (f) => denied(f, () => core.deleteMemory(f.deps, asBInA(f), f.itemA)),
  dismissMemoryProposal: (f) =>
    denied(f, () => core.dismissMemoryProposal(f.deps, asBInA(f), f.proposalA)),
  editMemory: (f) => denied(f, () => core.editMemory(f.deps, asBInA(f), f.itemA, { value: 'x' })),
  isMemoryPaused: (f) => denied(f, () => core.isMemoryPaused(f.deps, asBInA(f))),
  pauseMemory: (f) => denied(f, () => core.pauseMemory(f.deps, asBInA(f), f.itemA)),
  setMemoryPauseAll: (f) => denied(f, () => core.setMemoryPauseAll(f.deps, asBInA(f), true)),
  setSharedWithChamber: (f) =>
    denied(f, () => core.setSharedWithChamber(f.deps, asBInA(f), f.itemA, true)),
  embedMemoryItem: (f) => denied(f, () => core.embedMemoryItem(f.deps, asBInA(f), f.m3A, f.m1)),
  searchMatterMemory: (f) =>
    denied(f, () => core.searchMatterMemory(f.deps, asBInA(f), f.m1, 'vakalat')),
  proposeFromCorrection: (f) =>
    denied(f, () =>
      core.proposeFromCorrection(f.deps, asBInA(f), { alias: 'Rajan', canonical: 'M. Rajan' }),
    ),
  proposeFromEdit: (f) =>
    denied(f, () =>
      core.proposeFromEdit(f.deps, asBInA(f), {
        outputId: randomUUID(),
        pattern: 'carry index',
        key: 'M2.always_carry',
      }),
    ),
  proposeMemory: (f) => denied(f, () => core.proposeMemory(f.deps, asBInA(f), note)),
  exportMemory: (f) => denied(f, () => core.exportMemory(f.deps, asBInA(f))),
  getMemory: (f) => denied(f, () => core.getMemory(f.deps, asBInA(f), f.itemA)),
  listMemory: (f) => denied(f, () => core.listMemory(f.deps, asBInA(f))),
  memoryFor: (f) =>
    denied(f, () => core.memoryFor(f.deps, asBInA(f), { layers: ['M2'], purpose: 'brief' })),
  recordUsage: (f) =>
    denied(f, () => core.recordUsage(f.deps, asBInA(f), { itemId: f.itemA, usedIn: 'brief' })),
  tenureMetrics: (f) => denied(f, () => core.tenureMetrics(f.deps, asBInA(f))),
  monthlyReview: async (f) => {
    // A system body that takes a workspace id: B's review counts B's memory and nothing of A's.
    const review = await core.monthlyReview({ db: f.tx }, f.b.id);
    expect(review).toMatchObject({ workspaceId: f.b.id, activeItems: 0, pendingProposals: 0 });
    expect((await core.monthlyReview({ db: f.tx }, f.a.id)).activeItems).toBeGreaterThan(0);
  },
  purgeDeletedMemoryEmbeddings: async (f) => {
    // A deleted item of A keeps its embedding; a sweep of B removes none of A's.
    const before = await aState(f);
    expect(await core.purgeDeletedMemoryEmbeddings(f.tx, f.b.id)).toBe(0);
    expect(await aState(f)).toEqual(before);
    expect(await core.purgeDeletedMemoryEmbeddings(f.tx, f.a.id)).toBe(1);
  },
};

async function fixture(w: World): Promise<Fixture> {
  const item = await core.createMemoryNote(w.deps, w.owner, note);
  const proposal = await core.proposeMemory(w.deps, w.owner, {
    key: 'M2.client_update_tone',
    value: 'formal',
    scope: 'user',
  });
  const m3 = await core.createMemoryNote(w.deps, w.owner, {
    key: 'M3.synopsis',
    value: 'carry vakalat copy',
    scope: 'matter',
    matterId: w.m1,
  });
  await core.embedMemoryItem(w.deps, w.owner, m3.id, w.m1);
  const gone = await core.createMemoryNote(w.deps, w.owner, {
    key: 'M3.synopsis',
    value: 'to be deleted',
    scope: 'matter',
    matterId: w.m1,
  });
  await core.embedMemoryItem(w.deps, w.owner, gone.id, w.m1);
  await core.deleteMemory(w.deps, w.owner, gone.id, { matterId: w.m1 });
  await core.recordUsage(w.deps, w.owner, { itemId: item.id, usedIn: 'brief' });
  await core.setMemoryPauseAll(w.deps, w.advocate, true);
  return { ...w, itemA: item.id, proposalA: proposal?.id ?? '', m3A: m3.id };
}

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

describe('cross-tenant memory services: ub on workspace B against A (#72)', () => {
  it('has a case for every service the registry points here', () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.filter((name) => !(name in CASES))).toEqual([]);
    expect(Object.keys(CASES).filter((name) => !registered.includes(name))).toEqual([]);
  });

  it.each(registered)('%s', async (name) => {
    const run = CASES[name];
    if (run === undefined) throw new Error(`no cross-tenant case for ${name}`);
    await inWorld(async (w) => run(await fixture(w)));
  });
});

describe('cross-tenant memory SQL and a user who belongs to both workspaces (#72)', () => {
  it('B’s scope reads none of A’s memory rows and cannot write one for A', async () => {
    await inWorld(async (w) => {
      const f = await fixture(w);
      const rows = await inWorkspace(w.tx, w.b.id, async (s) => {
        const counts = [];
        for (const table of [
          'memory_item',
          'memory_proposal',
          'memory_embedding',
          'memory_usage',
          'memory_pause',
        ]) {
          const [row] = await s.execute<{ n: number }>(
            sql.raw(`select count(*)::int as n from ${table} where workspace_id = '${w.a.id}'`),
          );
          counts.push(row?.n);
        }
        return counts;
      });
      expect(rows).toEqual([0, 0, 0, 0, 0]);
      await expect(
        inWorkspace(w.tx, w.b.id, (s) =>
          s.transaction((inner) =>
            inner.insert(schema.memoryItem).values({
              workspaceId: w.a.id,
              layer: 'M2',
              key: 'M2.brief_format',
              scope: 'workspace',
              ownerUserId: w.ub,
              valueCiphertext: 'x',
              sourceType: 'manual',
              confirmationState: 'confirmed',
            }),
          ),
        ),
      ).rejects.toThrow();
      expect((await aState(f)).items.length).toBeGreaterThan(0);
    });
  });

  it('uboth works in A and in B without either leaking into the other, or into the user’s other seat', async () => {
    await inWorld(async (w) => {
      const f = await fixture(w);
      const inA = { userId: w.uboth, workspaceId: w.a.id };
      const inB = { userId: w.uboth, workspaceId: w.b.id };
      await core.setMemoryPauseAll(w.deps, inA, false);
      const mineA = await core.createMemoryNote(w.deps, inA, {
        key: 'M1.courts',
        value: ['A court'],
        scope: 'workspace',
      });
      const mineB = await core.createMemoryNote(w.deps, inB, {
        key: 'M1.courts',
        value: ['B court'],
        scope: 'workspace',
      });
      const readIds = async (actor: typeof inA) =>
        (await core.listMemory(w.deps, actor)).map((i) => i.id);
      expect(await readIds(inA)).toContain(mineA.id);
      expect(await readIds(inA)).not.toContain(mineB.id);
      expect(await readIds(inB)).toEqual([mineB.id]);

      // A's ids named in B's workspace are not found, and A is unchanged.
      const before = await aState(f);
      expect(await codeOf(core.getMemory(w.deps, inB, mineA.id))).toBe('NOT_FOUND');
      expect(await codeOf(core.editMemory(w.deps, inB, mineA.id, { value: ['x'] }))).toBe(
        'NOT_FOUND',
      );
      expect(await codeOf(core.deleteMemory(w.deps, inB, mineA.id))).toBe('NOT_FOUND');
      expect(await codeOf(core.confirmMemory(w.deps, inB, f.proposalA))).toBe('NOT_FOUND');
      expect(
        await codeOf(core.recordUsage(w.deps, inB, { itemId: mineA.id, usedIn: 'brief' })),
      ).toBe('NOT_FOUND');
      expect(await aState(f)).toEqual(before);

      // The sibling user's private rows in A stay private from uboth's advocate seat.
      expect(await codeOf(core.getMemory(w.deps, inA, f.itemA))).toBe('NOT_FOUND');
      // Pausing in B does not pause A.
      await core.setMemoryPauseAll(w.deps, inB, true);
      expect(
        (await core.memoryFor(w.deps, inA, { layers: ['M1'], purpose: 'brief' })).items.map(
          (i) => i.id,
        ),
      ).toContain(mineA.id);
      expect(
        (await core.memoryFor(w.deps, inB, { layers: ['M1'], purpose: 'brief' })).items,
      ).toEqual([]);
      const keysInUse = await inWorkspace(w.tx, w.a.id, (s) =>
        s.select().from(schema.workspaceKey).where(eq(schema.workspaceKey.workspaceId, w.a.id)),
      );
      expect(keysInUse).toHaveLength(1);
    });
  });
});
