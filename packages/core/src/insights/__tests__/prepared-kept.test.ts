// Prepared & Kept (#85) on the test database: the brief before the hearing, the obligations arising
// from it, no obligations, a reschedule, a delegated owner, the junior's own appearances.
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { failure } from '../../__tests__/fixtures.ts';
import { computePreparedKept } from '../index.ts';

import { addDirection, addHearing, insightsWorld, NOW } from './helpers.ts';

const BEFORE = new Date('2026-11-01T10:00:00Z');
const range = { range: 'custom', from: '2026-10-15', to: '2026-11-10' };

describe('computePreparedKept', () => {
  it('counts an appearance with a current brief and all obligations kept', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      const h = await addHearing(w, {
        heldOn: '2026-11-02',
        appearing: [w.ownerMember],
        preparedAt: BEFORE,
      });
      await addDirection(w, {
        orderId: h.orderId,
        status: 'done',
        owner: w.ownerMember,
        dueDate: '2026-11-06',
      });
      const result = await computePreparedKept({ db: tx, now: () => NOW }, w.owner, range);
      expect(result).toMatchObject({ numerator: 1, denominator: 1, rate: 1, pending: 0 });
    });
  });

  it('a hearing with no obligations is kept on the brief alone; no brief is not kept', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      await addHearing(w, { heldOn: '2026-11-02', appearing: [w.ownerMember], preparedAt: BEFORE });
      await addHearing(w, { heldOn: '2026-11-03', appearing: [w.ownerMember] });
      // Confirmed after the hearing day began does not count.
      await addHearing(w, {
        heldOn: '2026-11-04',
        appearing: [w.ownerMember],
        preparedAt: new Date('2026-11-04T08:00:00Z'),
      });
      const result = await computePreparedKept({ db: tx, now: () => NOW }, w.owner, range);
      expect(result).toMatchObject({ numerator: 1, denominator: 3 });
      expect(result.rate).toBeCloseTo(0.3333, 4);
    });
  });

  it('a missed or unowned obligation fails; a rescheduled or delegated one does not', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      const open = (heldOn: string) =>
        addHearing(w, { heldOn, appearing: [w.ownerMember], preparedAt: BEFORE });
      const missed = await open('2026-11-02');
      await addDirection(w, { orderId: missed.orderId, owner: w.ownerMember, dueDate: '2026-11-05' });
      const unowned = await open('2026-11-03');
      await addDirection(w, { orderId: unowned.orderId, owner: null, dueDate: '2026-11-20' });
      const moved = await open('2026-11-04');
      await addDirection(w, {
        orderId: moved.orderId,
        owner: w.ownerMember,
        dueDate: '2026-11-05',
        reschedules: [{ at: new Date('2026-11-04T05:00:00Z') }],
      });
      const delegated = await open('2026-11-05');
      await addDirection(w, {
        orderId: delegated.orderId,
        status: 'done',
        owner: w.juniorMember,
        dueDate: '2026-11-08',
      });
      const result = await computePreparedKept({ db: tx, now: () => NOW }, w.owner, range);
      expect(result).toMatchObject({ numerator: 2, denominator: 4, rate: 0.5 });
    });
  });

  it('leaves a hearing with a pending obligation out of the rate until it is decided', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      const h = await addHearing(w, {
        heldOn: '2026-11-09',
        appearing: [w.ownerMember],
        preparedAt: BEFORE,
      });
      await addDirection(w, { orderId: h.orderId, owner: w.ownerMember, dueDate: '2026-11-25' });
      const result = await computePreparedKept({ db: tx, now: () => NOW }, w.owner, range);
      expect(result).toMatchObject({ numerator: 0, denominator: 0, rate: null, pending: 1 });
    });
  });

  it('compares with the equal range before it and buckets by week', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      await addHearing(w, { heldOn: '2026-11-02', appearing: [w.ownerMember], preparedAt: BEFORE });
      await addHearing(w, { heldOn: '2026-10-06', appearing: [w.ownerMember] });
      const result = await computePreparedKept({ db: tx, now: () => NOW }, w.owner, {
        range: '4w',
      });
      expect(result.window).toEqual({ from: '2026-10-14', to: '2026-11-10' });
      expect(result.previous.window).toEqual({ from: '2026-09-16', to: '2026-10-13' });
      expect(result.previous).toMatchObject({ numerator: 0, denominator: 1, rate: 0 });
      expect(result.weeks.map((x) => x.week)).toContain('2026-W45');
      expect(result.weeks.find((x) => x.week === '2026-W45')).toMatchObject({ numerator: 1 });
    });
  });

  it('a junior counts only their own appearances; a clerk and a viewer are denied', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      await addHearing(w, { heldOn: '2026-11-02', appearing: [w.ownerMember], preparedAt: BEFORE });
      await addHearing(w, { heldOn: '2026-11-03', appearing: [w.juniorMember] });
      const deps = { db: tx, now: () => NOW };
      expect(await computePreparedKept(deps, w.owner, range)).toMatchObject({ denominator: 2 });
      expect(await computePreparedKept(deps, w.advocate, range)).toMatchObject({ denominator: 2 });
      expect(await computePreparedKept(deps, w.junior, range)).toMatchObject({
        numerator: 0,
        denominator: 1,
      });
      const other = { ...range, memberId: w.ownerMember };
      expect(((await failure(computePreparedKept(deps, w.junior, other))) as { code: string }).code).toBe('FORBIDDEN');
      for (const who of [w.clerk, w.viewer])
        expect(((await failure(computePreparedKept(deps, who, range))) as { code: string }).code).toBe('FORBIDDEN');
      expect(await computePreparedKept(deps, w.owner, { ...range, memberId: w.juniorMember })).toMatchObject({
        denominator: 1,
      });
    });
  });

  it('rejects a malformed range', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      const err = (await failure(
        computePreparedKept({ db: tx, now: () => NOW }, w.owner, { range: 'custom' }),
      )) as { code: string };
      expect(err.code).toBe('VALIDATION');
    });
  });
});
