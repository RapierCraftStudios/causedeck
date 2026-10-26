import { describe, expect, it } from 'vitest';

import {
  backtestEta,
  estimateCallWindow,
  itemNumber,
  paceSamples,
  type PaceObservation,
} from './eta.ts';

// 2026-10-19 is a Monday; 05:00 UTC is 10:30 IST.
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 19, 5, 0) + minutes * 60_000);
const sitting = (itemNo: string | null, minutes: number): PaceObservation => ({
  itemNo,
  status: 'sitting',
  observedAt: at(minutes),
});

// One item every 10 minutes, with a slower stretch: 2 items in 30 minutes.
const board = [
  sitting('1', 0),
  sitting('2', 10),
  sitting('3', 20),
  sitting('5', 50),
  sitting('6', 60),
];

describe('itemNumber', () => {
  it('reads the numeric part', () => {
    expect([itemNumber('14'), itemNumber('14A'), itemNumber(null), itemNumber('x')]).toEqual([
      14,
      14,
      null,
      null,
    ]);
  });
});

describe('paceSamples', () => {
  it('gives minutes per item between sitting observations of one day', () => {
    expect(paceSamples(board)).toEqual([10, 10, 15, 10]);
  });

  it('skips a risen hall, a gap over three hours and a new day', () => {
    const risen: PaceObservation = { ...sitting('4', 30), status: 'risen' };
    expect(paceSamples([sitting('1', 0), risen])).toEqual([]);
    expect(paceSamples([sitting('1', 0), sitting('2', 200)])).toEqual([]);
    expect(paceSamples([sitting('1', 0), sitting('2', 24 * 60 + 10)])).toEqual([]);
  });
});

describe('estimateCallWindow', () => {
  const now = at(60);

  it('is null without pace history', () => {
    expect(estimateCallWindow({ itemsAhead: 3, samples: [], now })).toBeNull();
  });

  it('reports a range scaled by the items ahead, never a point', () => {
    const window = estimateCallWindow({ itemsAhead: 4, samples: paceSamples(board), now });
    expect(window).not.toBeNull();
    expect(window?.medianMinutesPerItem).toBe(10);
    expect(window?.samples).toBe(4);
    // quartiles of [10, 10, 10, 15] are 10 and 11.25 minutes per item
    expect(window?.from.getTime()).toBe(now.getTime() + 40 * 60_000);
    expect(window?.to.getTime()).toBe(now.getTime() + 45 * 60_000);
    expect(window?.confidence).toBe('medium');
  });

  it('is low confidence on one sample', () => {
    expect(estimateCallWindow({ itemsAhead: 2, samples: [8], now })?.confidence).toBe('low');
  });
});

describe('backtestEta', () => {
  it('reports the median absolute error in minutes', () => {
    const result = backtestEta(board);
    expect(result.scored).toBeGreaterThan(0);
    expect(result.medianErrorMinutes).not.toBeNull();
    // the pace is 10 to 15 minutes per item: the median error stays within a few minutes
    expect(result.medianErrorMinutes ?? 99).toBeLessThanOrEqual(10);
  });

  it('is exact on a steady bench', () => {
    const steady = [0, 1, 2, 3, 4, 5].map((i) => sitting(String(i + 1), i * 10));
    const result = backtestEta(steady);
    expect(result.scored).toBeGreaterThan(0);
    expect(result.medianErrorMinutes).toBe(0);
  });

  it('scores nothing without two sitting observations', () => {
    expect(backtestEta([sitting('1', 0)])).toEqual({ scored: 0, medianErrorMinutes: null });
  });
});
