// The memory screen's read models (#73): pending proposals, where an item was used, the review
// candidates and the review date (`M1.last_memory_review`).
import { describe, expect, it } from 'vitest';

import { codeOf, DAY_MS, inWorld, T0 } from '../../__tests__/memory-world.ts';
import {
  completeMemoryReview,
  confirmMemory,
  createMemoryNote,
  getLastMemoryReview,
  listMemory,
  listMemoryProposals,
  listMemoryUsage,
  listMemoryWithUsage,
  listReviewCandidates,
  proposeMemory,
  recordUsage,
} from '../index.ts';

const note = { key: 'M2.brief_format', value: 'one page', scope: 'user' } as const;

describe('listMemoryProposals', () => {
  it('lists only the actor’s pending proposals, never a confirmed one or another member’s', async () => {
    await inWorld(async (w) => {
      const mine = await proposeMemory(w.deps, w.owner, { ...note, evidence: { count: 3 } });
      const done = await proposeMemory(w.deps, w.owner, {
        key: 'M2.client_update_tone',
        value: 'formal',
        scope: 'user',
      });
      await proposeMemory(w.deps, w.advocate, { ...note, value: 'two pages' });
      await confirmMemory(w.deps, w.owner, done?.id ?? '');

      const listed = await listMemoryProposals(w.deps, w.owner);
      expect(listed.map((p) => p.id)).toEqual([mine?.id]);
      expect(listed[0]?.evidence).toEqual({ count: 3 });
      expect(await listMemoryProposals(w.deps, w.asClerk)).toEqual([]);
    });
  });
});

describe('listMemoryUsage and listMemoryWithUsage', () => {
  it('lists the uses of a readable item and reports the last use', async () => {
    await inWorld(async (w) => {
      const item = await createMemoryNote(w.deps, w.owner, note);
      await recordUsage(w.at(new Date(T0.getTime() + DAY_MS)), w.owner, {
        itemId: item.id,
        usedIn: 'brief',
        outputRef: 'b1',
      });
      await recordUsage(w.at(new Date(T0.getTime() + 2 * DAY_MS)), w.owner, {
        itemId: item.id,
        usedIn: 'draft',
      });
      const usage = await listMemoryUsage(w.deps, w.owner, item.id);
      expect(usage.map((u) => u.usedIn)).toEqual(['draft', 'brief']);
      const [listed] = await listMemoryWithUsage(w.deps, w.owner);
      expect(listed?.lastUsedAt?.getTime()).toBe(T0.getTime() + 2 * DAY_MS);
    });
  });

  it('does not show another member’s private item usage', async () => {
    await inWorld(async (w) => {
      const item = await createMemoryNote(w.deps, w.owner, note);
      expect(await codeOf(listMemoryUsage(w.deps, w.advocate, item.id))).toBe('NOT_FOUND');
    });
  });
});

describe('monthly review', () => {
  it('records the review date, keeps one row, and hides it from the cards', async () => {
    await inWorld(async (w) => {
      expect(await getLastMemoryReview(w.deps, w.owner)).toBeNull();
      await createMemoryNote(w.deps, w.owner, note);
      const first = await completeMemoryReview(w.at(T0), w.owner);
      expect(first).toMatchObject({ completedAt: T0, activeItems: 1 });
      const later = new Date(T0.getTime() + 31 * DAY_MS);
      await completeMemoryReview(w.at(later), w.owner);
      expect((await getLastMemoryReview(w.deps, w.owner))?.getTime()).toBe(later.getTime());
      const all = await listMemory(w.deps, w.owner);
      expect(all.filter((i) => i.key === 'M1.last_memory_review')).toHaveLength(1);
      expect((await listMemoryWithUsage(w.deps, w.owner)).map((i) => i.key)).toEqual([
        'M2.brief_format',
      ]);
      expect(await getLastMemoryReview(w.deps, w.advocate)).toBeNull();
    });
  });

  it('offers only active items untouched for 60 days', async () => {
    await inWorld(async (w) => {
      const old = await createMemoryNote(w.at(T0), w.owner, note);
      const used = await createMemoryNote(w.at(T0), w.owner, {
        key: 'M2.always_carry',
        value: ['vakalat'],
        scope: 'user',
      });
      const now = new Date(T0.getTime() + 70 * DAY_MS);
      await recordUsage(w.at(new Date(T0.getTime() + 30 * DAY_MS)), w.owner, {
        itemId: used.id,
        usedIn: 'brief',
      });
      expect((await listReviewCandidates(w.at(now), w.owner)).map((i) => i.id)).toEqual([old.id]);
      expect(await listReviewCandidates(w.at(T0), w.owner)).toEqual([]);
    });
  });

  it('refuses a viewer', async () => {
    await inWorld(async (w) => {
      expect(await codeOf(completeMemoryReview(w.deps, w.asViewer))).toBe('FORBIDDEN');
    });
  });
});
