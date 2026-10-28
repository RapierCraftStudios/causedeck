// Edit, pause, delete and export (R9), usage and citations (R10), encryption and embeddings (R11),
// tenure metrics and the monthly review (R12), and the two jobs (#72).
import { randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import { decryptField, FIELD_PREFIX, getWorkspaceDek } from '@causedeck/storage';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
  confirmMemory,
  createMemoryNote,
  deleteMemory,
  dismissMemoryProposal,
  editMemory,
  embedMemoryItem,
  exportMemory,
  getMemory,
  listMemory,
  memoryFor,
  monthlyReview,
  pauseMemory,
  proposeFromEdit,
  proposeMemory,
  purgeDeletedMemoryEmbeddings,
  purgeMemoryTargets,
  recordUsage,
  reviewMemoryTargets,
  searchMatterMemory,
  tenureMetrics,
  type MemoryEmbedder,
} from '../index.ts';

import { codeOf, DAY_MS, inWorld, keys, T0, type World } from '../../__tests__/memory-world.ts';

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

const embeddings = (w: World, workspaceId = w.a.id) =>
  inWorkspace(w.tx, workspaceId, (s) => s.select().from(schema.memoryEmbedding));

async function m3(w: World, matterId: string, value: string) {
  return createMemoryNote(w.deps, w.owner, {
    key: 'M3.synopsis',
    value,
    scope: 'matter',
    matterId,
  });
}

describe('R9: edit, pause and delete per item', () => {
  it('edits a value (corrected), pauses and resumes an item', async () => {
    await inWorld(async (w) => {
      const item = await createMemoryNote(w.deps, w.owner, {
        key: 'M2.brief_format',
        value: 'long',
        scope: 'user',
      });
      const edited = await editMemory(w.deps, w.owner, item.id, { value: 'short' });
      expect(edited).toMatchObject({ value: 'short', confirmationState: 'corrected' });
      const read = async () =>
        ids((await memoryFor(w.deps, w.owner, { layers: ['M2'], purpose: 'draft' })).items);
      expect(await read()).toContain(item.id);

      await pauseMemory(w.deps, w.owner, item.id);
      expect(await read()).not.toContain(item.id);
      expect((await getMemory(w.deps, w.owner, item.id)).item.status).toBe('paused');
      expect(ids(await listMemory(w.deps, w.owner))).toContain(item.id);
      expect(ids(await exportMemory(w.deps, w.owner))).not.toContain(item.id);
      expect(await codeOf(recordUsage(w.deps, w.owner, { itemId: item.id, usedIn: 'draft' }))).toBe(
        'NOT_FOUND',
      );

      await pauseMemory(w.deps, w.owner, item.id, false);
      expect(await read()).toContain(item.id);
      // Only the author edits a private item.
      expect(await codeOf(editMemory(w.deps, w.advocate, item.id, { value: 'x' }))).toBe(
        'NOT_FOUND',
      );
    });
  });

  it('delete removes the value now and the embedding purge clears the vectors inside 24 h', async () => {
    await inWorld(async (w) => {
      const item = await m3(w, w.m1, 'carry vakalat copy to the first hearing');
      const kept = await m3(w, w.m1, 'client prefers tamil updates');
      expect(await embedMemoryItem(w.deps, w.owner, item.id, w.m1)).toBe(true);
      expect(await embedMemoryItem(w.deps, w.owner, kept.id, w.m1)).toBe(true);
      expect(await embeddings(w)).toHaveLength(2);

      const deletedAt = T0;
      await deleteMemory(w.at(deletedAt), w.owner, item.id, { matterId: w.m1 });
      // The value is gone at once.
      const [row] = await inWorkspace(w.tx, w.a.id, (s) =>
        s.select().from(schema.memoryItem).where(eq(schema.memoryItem.id, item.id)),
      );
      expect(row).toMatchObject({ status: 'deleted', valueCiphertext: null });
      expect(row?.deletedAt?.getTime()).toBe(deletedAt.getTime());
      expect(await codeOf(getMemory(w.deps, w.owner, item.id, { matterId: w.m1 }))).toBe(
        'NOT_FOUND',
      );
      expect(ids(await listMemory(w.deps, w.owner, { matterId: w.m1 }))).toEqual([kept.id]);
      expect(ids(await exportMemory(w.deps, w.owner))).not.toContain(item.id);
      // Its embedding is queued for purge: still there, and the sweep lists the workspace.
      expect(await embeddings(w)).toHaveLength(2);
      const queued = await purgeMemoryTargets(w.tx);
      expect(queued).toContain(w.a.id);
      expect(queued).not.toContain(w.b.id);

      // The hourly sweep, run any time before the 24 h mark, removes it and only it.
      const sweepAt = new Date(deletedAt.getTime() + 23 * 60 * 60 * 1000);
      expect(sweepAt.getTime() - deletedAt.getTime()).toBeLessThan(24 * 60 * 60 * 1000);
      expect(await purgeDeletedMemoryEmbeddings(w.tx, w.a.id)).toBe(1);
      const left = await embeddings(w);
      expect(left).toHaveLength(1);
      expect(left[0]?.itemId).toBe(kept.id);
      expect(await purgeDeletedMemoryEmbeddings(w.tx, w.a.id)).toBe(0);
      expect(await purgeMemoryTargets(w.tx)).not.toContain(w.a.id);
    });
  });

  it('an edit drops the item’s stale embedding', async () => {
    await inWorld(async (w) => {
      const item = await m3(w, w.m1, 'first wording');
      await embedMemoryItem(w.deps, w.owner, item.id, w.m1);
      expect(await embeddings(w)).toHaveLength(1);
      await editMemory(w.deps, w.owner, item.id, { value: 'second wording' }, { matterId: w.m1 });
      expect(await embeddings(w)).toHaveLength(0);
    });
  });

  it('export includes active items of the member and nothing deleted or paused', async () => {
    await inWorld(async (w) => {
      const active = await createMemoryNote(w.deps, w.owner, {
        key: 'M1.courts',
        value: ['A'],
        scope: 'workspace',
      });
      const paused = await createMemoryNote(w.deps, w.owner, {
        key: 'M1.languages',
        value: ['Tamil'],
        scope: 'workspace',
      });
      const gone = await createMemoryNote(w.deps, w.owner, {
        key: 'M1.practice_areas',
        value: ['Writ'],
        scope: 'workspace',
      });
      await pauseMemory(w.deps, w.owner, paused.id);
      await deleteMemory(w.deps, w.owner, gone.id);
      const exported = await exportMemory(w.deps, w.owner);
      expect(ids(exported)).toContain(active.id);
      expect(ids(exported)).not.toContain(paused.id);
      expect(ids(exported)).not.toContain(gone.id);
      expect(exported.find((i) => i.id === active.id)?.value).toEqual(['A']);
    });
  });
});

describe('R10: usage and citations', () => {
  it('records each use with the item id and cites it as "because of your note on <date>"', async () => {
    await inWorld(async (w) => {
      const item = await createMemoryNote(w.at(T0), w.owner, {
        key: 'M2.always_carry',
        value: ['vakalat copy'],
        scope: 'user',
      });
      expect(
        await recordUsage(w.deps, w.owner, {
          itemId: item.id,
          usedIn: 'brief',
          outputRef: 'brief-9',
        }),
      ).toBe(true);
      await recordUsage(w.deps, w.owner, { itemId: item.id, usedIn: 'matching' });
      const rows = await inWorkspace(w.tx, w.a.id, (s) =>
        s.select().from(schema.memoryUsage).where(eq(schema.memoryUsage.itemId, item.id)),
      );
      expect(rows.map((r) => r.usedIn).sort()).toEqual(['brief', 'matching']);
      expect(rows.find((r) => r.usedIn === 'brief')?.outputRef).toBe('brief-9');
      expect(rows.every((r) => r.userId === w.ua)).toBe(true);

      const out = await memoryFor(w.deps, w.owner, { layers: ['M2'], purpose: 'brief' });
      const citation = out.citations.find((c) => c.itemId === item.id);
      expect(citation).toMatchObject({ key: 'M2.always_carry', layer: 'M2' });
      expect(citation?.label).toBe('because of your note on 2026-10-20');
      expect(citation?.date.getTime()).toBe(T0.getTime());
      expect((await getMemory(w.deps, w.owner, item.id)).citation.itemId).toBe(item.id);
    });
  });

  it('refuses to record use of an item the member cannot read', async () => {
    await inWorld(async (w) => {
      const private4 = await createMemoryNote(w.deps, w.owner, {
        key: 'M4.hall_note',
        value: 'hall',
        scope: 'user',
      });
      expect(
        await codeOf(recordUsage(w.deps, w.advocate, { itemId: private4.id, usedIn: 'brief' })),
      ).toBe('NOT_FOUND');
      expect(
        await codeOf(recordUsage(w.deps, w.asViewer, { itemId: private4.id, usedIn: 'brief' })),
      ).toBe('NOT_FOUND');
    });
  });
});

describe('R11: encryption and embeddings', () => {
  it('stores values envelope-encrypted under the workspace key and nowhere in the clear', async () => {
    await inWorld(async (w) => {
      const secret = 'settle only above fifteen lakh';
      const pending = await proposeMemory(w.deps, w.owner, {
        key: 'M2.settlement_posture',
        value: secret,
        scope: 'user',
        evidence: { count: 1 },
      });
      const item = await confirmMemory(w.deps, w.owner, pending?.id ?? '');
      const [row] = await inWorkspace(w.tx, w.a.id, (s) =>
        s.select().from(schema.memoryItem).where(eq(schema.memoryItem.id, item.id)),
      );
      const [proposal] = await inWorkspace(w.tx, w.a.id, (s) =>
        s
          .select()
          .from(schema.memoryProposal)
          .where(eq(schema.memoryProposal.id, pending?.id ?? '')),
      );
      expect(row?.valueCiphertext?.startsWith(FIELD_PREFIX)).toBe(true);
      expect(JSON.stringify(row)).not.toContain(secret);
      expect(JSON.stringify(proposal)).not.toContain(secret);
      const dek = await getWorkspaceDek(w.tx, keys, w.a.id);
      expect(JSON.parse(decryptField(dek, w.a.id, row?.valueCiphertext ?? ''))).toBe(secret);
      // The AAD is the workspace id: the ciphertext does not open as another workspace's.
      expect(() => decryptField(dek, w.b.id, row?.valueCiphertext ?? '')).toThrow();
    });
  });

  it('never sends memory to a provider outside India, or of a sensitive matter to any provider', async () => {
    await inWorld(async (w) => {
      const item = await m3(w, w.m1, 'tamil updates preferred');
      const embed = vi.fn(() => Promise.resolve(new Array<number>(1024).fill(0)));
      const abroad: MemoryEmbedder = { region: 'other', embed };
      expect(await codeOf(embedMemoryItem(w.deps, w.owner, item.id, w.m1, abroad))).toBe(
        'FORBIDDEN',
      );
      const sensitive = await inWorkspace(w.tx, w.a.id, async (s) => {
        const { buildMatter } = await import('@causedeck/db/testing/matter-graph-fixtures');
        return (await buildMatter(s, w.a.id, { title: 'Sensitive', sensitive: true })).id;
      });
      const hidden = await m3(w, sensitive, 'sensitive matter note');
      const india: MemoryEmbedder = { region: 'india', embed };
      expect(await codeOf(embedMemoryItem(w.deps, w.owner, hidden.id, sensitive, india))).toBe(
        'FORBIDDEN',
      );
      expect(embed).not.toHaveBeenCalled();
      expect(await embedMemoryItem(w.deps, w.owner, item.id, w.m1, india)).toBe(true);
      expect(embed).toHaveBeenCalledTimes(1);
      // Only M3 is embedded.
      const pref = await createMemoryNote(w.deps, w.owner, {
        key: 'M2.brief_format',
        value: 'x',
        scope: 'user',
      });
      expect(await codeOf(embedMemoryItem(w.deps, w.owner, pref.id, w.m1))).toBe('NOT_FOUND');
    });
  });

  it('searches by similarity inside one matter only', async () => {
    await inWorld(async (w) => {
      const one = await m3(w, w.m1, 'carry vakalat copy to every first hearing');
      const two = await m3(w, w.m2, 'carry vakalat copy to every first hearing');
      await embedMemoryItem(w.deps, w.owner, one.id, w.m1);
      await embedMemoryItem(w.deps, w.owner, two.id, w.m2);
      expect(await searchMatterMemory(w.deps, w.owner, w.m1, 'vakalat copy first hearing')).toEqual(
        [one.id],
      );
      expect(await searchMatterMemory(w.deps, w.owner, w.m2, 'vakalat copy first hearing')).toEqual(
        [two.id],
      );
      expect(await searchMatterMemory(w.deps, w.asClerk, w.m1, 'vakalat')).toEqual([]);
    });
  });
});

describe('R12: tenure metrics and the monthly review', () => {
  it('reports confirmation and correction rates by tenure week and the unedited brief rate', async () => {
    await inWorld(async (w) => {
      const start = await inWorkspace(w.tx, w.a.id, async (s) => {
        const [org] = await s
          .select({ createdAt: schema.organization.createdAt })
          .from(schema.organization)
          .where(eq(schema.organization.id, w.a.id));
        return org?.createdAt ?? new Date();
      });
      const day = (n: number) => w.at(new Date(start.getTime() + n * DAY_MS));
      const propose = (n: number, key: string, value: string) =>
        proposeMemory(day(n), w.owner, { key, value, scope: 'user' });
      // Week 0: two confirmed (one corrected) and one dismissed. Week 2: one confirmed.
      const p1 = await propose(1, 'M2.brief_format', 'one page');
      const p2 = await propose(1, 'M2.client_update_tone', 'formal');
      const p3 = await propose(1, 'M2.always_carry', 'index');
      await confirmMemory(day(1), w.owner, p1?.id ?? '');
      await confirmMemory(day(1), w.owner, p2?.id ?? '', { value: 'warm' });
      await dismissMemoryProposal(day(1), w.owner, p3?.id ?? '');
      const p4 = await propose(15, 'M1.courts', 'Madras High Court');
      await confirmMemory(day(15), w.owner, p4?.id ?? '');

      // Two briefs used memory; an edit pattern was seen in one of them.
      const item = await createMemoryNote(day(2), w.owner, {
        key: 'M2.brief_format',
        value: 'x',
        scope: 'user',
      });
      const edited = randomUUID();
      await recordUsage(day(2), w.owner, { itemId: item.id, usedIn: 'brief', outputRef: edited });
      await recordUsage(day(2), w.owner, {
        itemId: item.id,
        usedIn: 'brief',
        outputRef: randomUUID(),
      });
      await proposeFromEdit(day(2), w.owner, {
        outputId: edited,
        pattern: 'carry index',
        key: 'M2.always_carry',
      });

      const metrics = await tenureMetrics(w.deps, w.owner);
      const week0 = metrics.weeks.find((x) => x.week === 0);
      const week2 = metrics.weeks.find((x) => x.week === 2);
      expect(week0).toMatchObject({ proposalsDecided: 3, confirmed: 2, confirmationRate: 0.667 });
      expect(week0?.itemsSaved).toBe(3);
      expect(week0?.corrected).toBe(1);
      expect(week0?.correctionRate).toBe(0.333);
      expect(week2).toMatchObject({
        proposalsDecided: 1,
        confirmed: 1,
        confirmationRate: 1,
        correctionRate: 0,
      });
      expect(metrics.briefAcceptedUnedited).toEqual({ briefs: 2, unedited: 1, rate: 0.5 });
      // Aggregate, within the workspace, owners and advocates only; no content.
      expect(JSON.stringify(metrics)).not.toContain('one page');
      expect(await codeOf(tenureMetrics(w.deps, w.asJunior))).toBe('FORBIDDEN');
      expect(await codeOf(tenureMetrics(w.deps, w.asClerk))).toBe('FORBIDDEN');
      expect(await codeOf(tenureMetrics(w.deps, { userId: w.ub, workspaceId: w.a.id }))).toBe(
        'NOT_FOUND',
      );
      const other = await tenureMetrics(w.deps, w.ownerB);
      expect(other.weeks).toEqual([]);
      expect(other.briefAcceptedUnedited).toEqual({ briefs: 0, unedited: 0, rate: null });
    });
  });

  it('prepares a monthly review of counts only, and the job queues one per workspace', async () => {
    await inWorld(async (w) => {
      const used = await createMemoryNote(w.at(T0), w.owner, {
        key: 'M1.courts',
        value: ['A'],
        scope: 'workspace',
      });
      await createMemoryNote(w.at(T0), w.owner, {
        key: 'M1.languages',
        value: ['Tamil'],
        scope: 'workspace',
      });
      const paused = await createMemoryNote(w.at(T0), w.owner, {
        key: 'M1.practice_areas',
        value: ['Writ'],
        scope: 'workspace',
      });
      await pauseMemory(w.at(T0), w.owner, paused.id);
      await recordUsage(w.at(new Date(T0.getTime() + 95 * DAY_MS)), w.owner, {
        itemId: used.id,
        usedIn: 'brief',
      });
      await proposeMemory(w.at(T0), w.owner, {
        key: 'M2.brief_format',
        value: 'one page',
        scope: 'user',
      });

      const review = await monthlyReview(
        { db: w.tx, now: () => new Date(T0.getTime() + 100 * DAY_MS) },
        w.a.id,
      );
      expect(review).toMatchObject({
        workspaceId: w.a.id,
        activeItems: 2,
        pausedItems: 1,
        staleItems: 1,
        pendingProposals: 1,
      });
      expect(JSON.stringify(review)).not.toContain('one page');
      const none = await monthlyReview({ db: w.tx }, w.b.id);
      expect(none).toMatchObject({ activeItems: 0, pausedItems: 0, pendingProposals: 0 });

      const queued = await reviewMemoryTargets(w.tx);
      expect(queued).toContain(w.a.id);
      expect(queued).not.toContain(w.b.id);
      expect(
        await inWorkspace(w.tx, w.a.id, (s) =>
          s
            .select()
            .from(schema.memoryItem)
            .where(
              and(
                eq(schema.memoryItem.workspaceId, w.a.id),
                eq(schema.memoryItem.status, 'active'),
              ),
            ),
        ),
      ).toHaveLength(2);
    });
  });
});
