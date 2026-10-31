import { FREE_ALERTS_LIMITS, fetchCostMicros, freeAlertsLimitsFor } from '@causedeck/billing';
import { describe, expect, it, vi } from 'vitest';

import { STATUS_SOURCES } from '../../case-watch/index.ts';
import {
  admitLookup,
  FORUM_STATUS_SOURCES,
  getFetchBudget,
  recordFetchCost,
  statusSourceForForum,
  UPGRADE_PROMPTS,
  type FetchBudgetStore,
} from '../index.ts';

function store(limits: typeof FREE_ALERTS_LIMITS | null, spent = 0) {
  let total = spent;
  const add = vi.fn((_ws: string, micros: number) => {
    total += micros;
    return Promise.resolve();
  });
  const s: FetchBudgetStore = {
    limits: () => Promise.resolve(limits),
    spent: () => Promise.resolve(total),
    add,
  };
  return { s, add };
}

const on = () => Promise.resolve(true);

describe('free alerts limits (billing data)', () => {
  it('gives the free Junior plan an allowance and no paid plan one', () => {
    expect(freeAlertsLimitsFor('junior')).toBe(FREE_ALERTS_LIMITS);
    expect(freeAlertsLimitsFor('advocate-monthly-1')).toBeNull();
    expect(freeAlertsLimitsFor('chamber-seat-1')).toBeNull();
    // A priced plan never reads as free even if a table lists it.
    expect(
      freeAlertsLimitsFor('advocate-monthly-1', { 'advocate-monthly-1': FREE_ALERTS_LIMITS }),
    ).toBeNull();
  });

  it('converts a fetch cost to whole micro-dollars with a floor', () => {
    expect(fetchCostMicros(0.03)).toBe(30_000);
    expect(fetchCostMicros(0.0000004)).toBe(1);
    expect(fetchCostMicros(0, 1_000)).toBe(1_000);
    expect(() => fetchCostMicros(-1)).toThrow(RangeError);
  });

  it('keeps the ceiling under the cap so one lookup always fits an empty month', () => {
    expect(FREE_ALERTS_LIMITS.fetchCostCeilingMicros).toBeLessThan(
      FREE_ALERTS_LIMITS.fetchCostCapMicrosPerMonth,
    );
  });
});

describe('fetch budget', () => {
  it('admits while spend plus the ceiling fits the cap and refuses after', async () => {
    const { s } = store(FREE_ALERTS_LIMITS);
    const deps = { db: {} as never, store: s, flagEnabled: on };
    expect(await admitLookup(deps, 'ws')).toBe(true);
    for (let spent = 0; ;) {
      const { s: at } = store(FREE_ALERTS_LIMITS, spent);
      const ok = await admitLookup({ ...deps, store: at }, 'ws');
      expect(ok).toBe(
        spent + FREE_ALERTS_LIMITS.fetchCostCeilingMicros <=
          FREE_ALERTS_LIMITS.fetchCostCapMicrosPerMonth,
      );
      if (!ok) break;
      spent += 10_000;
    }
  });

  it('is uncapped for a paid plan and while the flag is off, and records nothing then', async () => {
    const paid = store(null, 10 ** 9);
    expect(await admitLookup({ db: {} as never, store: paid.s, flagEnabled: on }, 'ws')).toBe(true);
    expect(
      await recordFetchCost({ db: {} as never, store: paid.s, flagEnabled: on }, 'ws', 0.5, 'k'),
    ).toBe(0);
    const dark = store(FREE_ALERTS_LIMITS, 10 ** 9);
    const darkDeps = { db: {} as never, store: dark.s, flagEnabled: () => Promise.resolve(false) };
    expect(await admitLookup(darkDeps, 'ws')).toBe(true);
    expect((await getFetchBudget(darkDeps, 'ws')).capped).toBe(false);
    expect(paid.add).not.toHaveBeenCalled();
    expect(dark.add).not.toHaveBeenCalled();
  });

  it('records a free fetch at the tier floor when the fetch itself cost nothing', async () => {
    const { s, add } = store(FREE_ALERTS_LIMITS);
    const micros = await recordFetchCost(
      { db: {} as never, store: s, flagEnabled: on },
      'ws',
      0,
      'k',
    );
    expect(micros).toBe(FREE_ALERTS_LIMITS.fetchCostFloorMicros);
    expect(add).toHaveBeenCalledWith('ws', micros, 'fetch:k', expect.any(Date));
  });

  it('reports what is left under the cap', async () => {
    const { s } = store(FREE_ALERTS_LIMITS, 120_000);
    const budget = await getFetchBudget({ db: {} as never, store: s, flagEnabled: on }, 'ws');
    expect(budget).toMatchObject({ capped: true, spentMicros: 120_000, remainingMicros: 380_000 });
  });
});

describe('forum status sources', () => {
  it('maps forum codes to a status source that exists, the longest prefix first', () => {
    expect(statusSourceForForum('in.tn.madras-hc.principal.appellate')).toBe(
      'in.tn.madras-hc.chennai:case_status',
    );
    expect(statusSourceForForum('in.tn.chennai-district.city-civil')).toBe(
      'in.tn.chennai-district:case_status',
    );
    expect(statusSourceForForum('in.tn.madurai-district.x')).toBe('in.tn.district:case_status');
    expect(statusSourceForForum('in.kl.high-court')).toBeNull();
  });

  it('only lists sources the status lookup can read', () => {
    for (const [, sourceId] of FORUM_STATUS_SOURCES) expect(sourceId in STATUS_SOURCES).toBe(true);
  });
});

describe('upgrade prompts', () => {
  it('has one plain line per moment and never names a party', () => {
    for (const line of Object.values(UPGRADE_PROMPTS)) {
      expect(line.length).toBeGreaterThan(20);
      expect(line).not.toMatch(/v\.|vs\./i);
    }
  });
});
