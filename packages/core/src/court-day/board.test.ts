import type { DisplayBoardRow } from '@causedeck/adapters';
import { describe, expect, it, vi } from 'vitest';

import { isCourtHours, planBoardAlert, pollBoards } from './board.ts';

const row = (over: Partial<DisplayBoardRow> = {}): DisplayBoardRow => ({
  hallNo: '3',
  itemNow: '10',
  status: 'sitting',
  passedOver: [],
  ...over,
});

describe('isCourtHours (IST)', () => {
  it('is Mon-Fri 10:30-17:00', () => {
    // 2026-10-19 is a Monday; IST is UTC+05:30.
    expect(isCourtHours(new Date('2026-10-19T05:00:00Z'))).toBe(true); // 10:30
    expect(isCourtHours(new Date('2026-10-19T04:59:00Z'))).toBe(false); // 10:29
    expect(isCourtHours(new Date('2026-10-19T11:29:00Z'))).toBe(true); // 16:59
    expect(isCourtHours(new Date('2026-10-19T11:30:00Z'))).toBe(false); // 17:00
    expect(isCourtHours(new Date('2026-10-24T06:00:00Z'))).toBe(false); // Saturday
  });
});

describe('planBoardAlert', () => {
  it('alerts at 5 away, 2 away and now, once per threshold kind', () => {
    expect(planBoardAlert({ itemNo: '15' }, row())?.kind).toBe('5');
    expect(planBoardAlert({ itemNo: '12' }, row())?.kind).toBe('2');
    expect(planBoardAlert({ itemNo: '10' }, row())?.kind).toBe('now');
    expect(planBoardAlert({ itemNo: '16' }, row())).toBeNull();
    // 4 and 5 away share the 5 threshold, so they share a dedupe key
    expect(planBoardAlert({ itemNo: '14' }, row())?.kind).toBe('5');
  });

  it('honours configured thresholds', () => {
    expect(planBoardAlert({ itemNo: '13' }, row(), [3])?.kind).toBe('3');
    expect(planBoardAlert({ itemNo: '15' }, row(), [3])).toBeNull();
  });

  it('alerts when the hall rises before the item and when it is passed over', () => {
    expect(planBoardAlert({ itemNo: '20' }, row({ status: 'risen' }))?.kind).toBe('risen');
    expect(planBoardAlert({ itemNo: '5' }, row({ status: 'risen' }))).toBeNull();
    const passed = planBoardAlert({ itemNo: '8' }, row({ passedOver: ['8'] }));
    expect(passed?.kind).toBe('passed_over');
  });

  it('says nothing for an item already heard, a lunch break or no item shown', () => {
    expect(planBoardAlert({ itemNo: '4' }, row())).toBeNull();
    expect(planBoardAlert({ itemNo: '12' }, row({ status: 'lunch' }))).toBeNull();
    expect(planBoardAlert({ itemNo: '12' }, row({ itemNow: null }))).toBeNull();
  });

  it('names hall and item numbers only', () => {
    expect(planBoardAlert({ itemNo: '12' }, row())?.title).toBe('Your item 12 in Hall 3 is 2 away');
  });
});

describe('pollBoards gates', () => {
  it('fetches nothing outside court hours', async () => {
    const fetchSource = vi.fn();
    const execute = vi.fn();
    const report = await pollBoards({
      db: { execute } as never,
      fetcher: { fetchSource },
      enqueueDelivery: () => Promise.resolve(),
      clock: { now: () => new Date('2026-10-19T03:00:00Z') },
    });
    expect(report).toEqual({ outcome: 'outside_court_hours', fetched: 0, observed: 0, alerts: 0 });
    expect(execute).not.toHaveBeenCalled();
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('fetches nothing when no workspace lists a hall today', async () => {
    const fetchSource = vi.fn();
    const report = await pollBoards({
      db: { execute: () => Promise.resolve([]) } as never,
      fetcher: { fetchSource },
      enqueueDelivery: () => Promise.resolve(),
      clock: { now: () => new Date('2026-10-19T06:00:00Z') },
    });
    expect(report.outcome).toBe('no_targets');
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('fetches nothing while the flag is off', async () => {
    const fetchSource = vi.fn();
    const target = {
      workspace_id: 'w1',
      listing_id: 'l1',
      proceeding_id: 'p1',
      owner_user_id: 'u1',
      slug: 'demo',
      forum_code: 'in.ka.karnataka-hc.bengaluru',
      hall_no: '3',
      item_no: '12',
    };
    const report = await pollBoards({
      db: { execute: () => Promise.resolve([target]) } as never,
      fetcher: { fetchSource },
      enqueueDelivery: () => Promise.resolve(),
      clock: { now: () => new Date('2026-10-19T06:00:00Z') },
      flagEnabled: () => Promise.resolve(false),
    });
    expect(report.outcome).toBe('flag_off');
    expect(fetchSource).not.toHaveBeenCalled();
  });
});
