// The preparedness and load series (#85): weekly points, the baseline delta, hidden below n = 5.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { loadSeries, preparednessSeries } from '../index.ts';

import { addHearing, insightsWorld, NOW, type World } from './helpers.ts';

const range = { range: 'custom', from: '2026-10-15', to: '2026-11-10' };

async function rate(w: World, memberId: string, rating: number, at: string, baseline = false) {
  const h = await addHearing(w, { heldOn: at.slice(0, 10), appearing: [memberId] });
  await inWorkspace(w.tx, w.workspaceId, async (s) => {
    const [row] = await s
      .select({ id: schema.appearance.id })
      .from(schema.appearance)
      .where(eqHearing(h.hearingId));
    await s.insert(schema.preparednessRating).values({
      workspaceId: w.workspaceId,
      appearanceId: String(row?.id),
      memberId,
      rating,
      baseline,
      createdAt: new Date(`${at}T10:00:00+05:30`),
    });
  });
}

import { eq } from 'drizzle-orm';
const eqHearing = (id: string) => eq(schema.appearance.hearingId, id);

describe('preparednessSeries', () => {
  it('hides the numbers below five ratings and explains with n', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      for (let i = 0; i < 4; i++) await rate(w, w.ownerMember, 4, `2026-11-0${i + 1}`);
      const result = await preparednessSeries({ db: tx, now: () => NOW }, w.owner, range);
      expect(result).toMatchObject({ n: 4, hidden: true, average: null, delta: null, points: [] });
    });
  });

  it('plots weekly averages with the baseline and the delta from five ratings', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      await rate(w, w.ownerMember, 2, '2026-10-16', true);
      for (const [rating, day] of [
        [4, '2026-10-27'],
        [5, '2026-10-28'],
        [4, '2026-11-03'],
        [5, '2026-11-04'],
        [4, '2026-11-05'],
      ] as const)
        await rate(w, w.ownerMember, rating, day);
      const result = await preparednessSeries({ db: tx, now: () => NOW }, w.owner, range);
      expect(result).toMatchObject({ n: 6, hidden: false, baselineAverage: 2 });
      expect(result.average).toBe(4);
      expect(result.delta).toBe(2);
      expect(result.points.reduce((sum, p) => sum + p.n, 0)).toBe(6);
    });
  });

  it("a junior's series holds only their own ratings", async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      for (let i = 1; i <= 5; i++) await rate(w, w.ownerMember, 5, `2026-11-0${i}`);
      const deps = { db: tx, now: () => NOW };
      expect((await preparednessSeries(deps, w.owner, range)).n).toBe(5);
      expect((await preparednessSeries(deps, w.junior, range)).n).toBe(0);
    });
  });
});

describe('loadSeries', () => {
  it('averages the three items by week, baseline delta, hidden below five pulses', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      const pulse = (week: string, at: string, v: number, baseline = false) =>
        inWorkspace(tx, w.workspaceId, (s) =>
          s.insert(schema.loadPulse).values({
            workspaceId: w.workspaceId,
            memberId: w.ownerMember,
            isoWeek: week,
            demand: v,
            worry: v,
            effort: v,
            baseline,
            createdAt: new Date(`${at}T10:00:00+05:30`),
          }),
        );
      await pulse('2026-W43', '2026-10-20', 2, true);
      const deps = { db: tx, now: () => NOW };
      expect(await loadSeries(deps, w.owner, range)).toMatchObject({ n: 1, hidden: true });
      for (const [week, at] of [
        ['2026-W44', '2026-10-27'],
        ['2026-W45', '2026-11-03'],
        ['2026-W46', '2026-11-09'],
      ] as const) {
        await pulse(week, at, 4);
      }
      await inWorkspace(tx, w.workspaceId, (s) =>
        s.insert(schema.loadPulse).values({
          workspaceId: w.workspaceId,
          memberId: w.ownerMember,
          isoWeek: '2026-W42',
          demand: null,
          worry: null,
          effort: null,
          dismissedAt: NOW,
          createdAt: new Date('2026-10-16T10:00:00+05:30'),
        }),
      );
      expect((await loadSeries(deps, w.owner, range)).hidden).toBe(true);
      await pulse('2026-W47', '2026-11-10', 4);
      const result = await loadSeries(deps, w.owner, range);
      expect(result).toMatchObject({ n: 5, hidden: false, demand: 3.6, baselineAverage: 2 });
      expect(result.delta).toBe(1.6);
      expect(result.points).toHaveLength(5);
    });
  });
});
