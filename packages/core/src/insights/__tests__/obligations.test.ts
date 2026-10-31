// Obligation health (#85): the missed rate, capture completeness and deliberate reschedules; a
// deliberate reschedule never counts as a miss; a junior sees only the obligations they own.
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { obligationHealth } from '../index.ts';

import { addDirection, addHearing, insightsWorld, NOW } from './helpers.ts';

const range = { range: 'custom', from: '2026-10-15', to: '2026-11-10' };

describe('obligationHealth', () => {
  it('computes missed over due, with reschedules never a miss', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      const h = await addHearing(w, { heldOn: '2026-11-02', appearing: [w.ownerMember] });
      const o = w.ownerMember;
      await addDirection(w, {
        orderId: h.orderId,
        status: 'done',
        owner: o,
        dueDate: '2026-11-03',
      });
      await addDirection(w, { orderId: h.orderId, owner: o, dueDate: '2026-11-04' });
      await addDirection(w, {
        orderId: h.orderId,
        owner: o,
        dueDate: '2026-11-05',
        reschedules: [
          { at: new Date('2026-11-04T05:00:00Z') },
          { at: new Date('2026-11-05T05:00:00Z') },
        ],
      });
      // Not yet due, and closed as not applicable: neither is due.
      await addDirection(w, { orderId: h.orderId, owner: o, dueDate: '2026-11-30' });
      await addDirection(w, {
        orderId: h.orderId,
        status: 'not_applicable',
        owner: o,
        dueDate: '2026-11-06',
      });
      const result = await obligationHealth({ db: tx, now: () => NOW }, w.owner, range);
      expect(result).toMatchObject({
        due: 3,
        kept: 1,
        missed: 1,
        deliberateReschedules: 2,
        capturedTotal: 5,
        captured: 5,
      });
      expect(result.missedRate).toBeCloseTo(0.3333, 4);
    });
  });

  it('measures capture completeness: an unowned direction is not captured', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      const h = await addHearing(w, { heldOn: '2026-11-02', appearing: [w.ownerMember] });
      await addDirection(w, { orderId: h.orderId, owner: w.ownerMember, dueDate: '2026-11-30' });
      await addDirection(w, { orderId: h.orderId, owner: null, dueDate: '2026-11-30' });
      const result = await obligationHealth({ db: tx, now: () => NOW }, w.owner, range);
      expect(result).toMatchObject({ capturedTotal: 2, captured: 1, captureCompleteness: 0.5 });
    });
  });

  it('is empty without obligations (rates are null) and a junior sees only their own', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      const deps = { db: tx, now: () => NOW };
      expect(await obligationHealth(deps, w.owner, range)).toMatchObject({
        due: 0,
        missedRate: null,
      });
      const h = await addHearing(w, { heldOn: '2026-11-02', appearing: [w.ownerMember] });
      await addDirection(w, { orderId: h.orderId, owner: w.ownerMember, dueDate: '2026-11-04' });
      await addDirection(w, { orderId: h.orderId, owner: w.juniorMember, dueDate: '2026-11-04' });
      expect(await obligationHealth(deps, w.owner, range)).toMatchObject({ due: 2, missed: 2 });
      expect(await obligationHealth(deps, w.junior, range)).toMatchObject({ due: 1, missed: 1 });
    });
  });
});
