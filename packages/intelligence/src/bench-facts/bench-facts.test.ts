import { describe, expect, it, vi } from 'vitest';

import {
  benchForHall,
  loadBenchPace,
  recordBenchFacts,
  summariseHallDay,
  type HallObservation,
} from './index.ts';

const at = (hhmm: string) => new Date(`2026-10-19T${hhmm}:00+05:30`);
const obs = (
  itemNo: string | null,
  time: string,
  over: Partial<HallObservation> = {},
): HallObservation => ({
  itemNo,
  status: 'sitting',
  passedOver: [],
  observedAt: at(time),
  ...over,
});

describe('summariseHallDay', () => {
  it('counts listed, heard and disposed and the median pace', () => {
    const facts = summariseHallDay([
      obs('1', '10:30'),
      obs('3', '10:40'),
      obs('5', '10:50'),
      obs('7', '11:00', { passedOver: ['6'] }),
    ]);
    expect(facts).toEqual({ itemsListed: 7, itemsHeard: 4, itemsDisposed: 4, minutesPerItem: 5 });
  });

  it('excludes passed-over items from disposed and never lets heard exceed listed', () => {
    const facts = summariseHallDay([obs('2', '10:30', { passedOver: ['2'] }), obs('3', '10:35')]);
    expect(facts.itemsHeard).toBe(2);
    expect(facts.itemsDisposed).toBe(1);
    expect(facts.itemsListed).toBeGreaterThanOrEqual(facts.itemsHeard);
  });

  it('has no pace with too few samples or across a break, and ignores non-sitting rows', () => {
    expect(summariseHallDay([obs('1', '10:30'), obs('2', '10:40')]).minutesPerItem).toBeNull();
    expect(
      summariseHallDay([obs('1', '10:30'), obs('2', '14:30'), obs('3', '14:40')]).minutesPerItem,
    ).toBeNull();
    expect(summariseHallDay([obs('9', '10:30', { status: 'lunch' })]).itemsHeard).toBe(0);
  });
});

describe('benchForHall', () => {
  const rows = [
    { forum_code: 'in.ka.karnataka-hc.bengaluru', hall_no: '3', bench_id: 'b1' },
    { forum_code: 'in.ka.karnataka-hc.dharwad', hall_no: '3', bench_id: 'b2' },
  ];
  it('resolves only a single bench for the forum prefix', () => {
    expect(benchForHall(rows, 'in.ka.karnataka-hc.bengaluru', '3')).toBe('b1');
    expect(benchForHall(rows, 'in.ka.karnataka-hc', '3')).toBeNull();
    expect(benchForHall(rows, 'in.ka.karnataka-hc.bengaluru', '9')).toBeNull();
  });
});

describe('persistence goes through the definer functions', () => {
  it('writes with app_bench_fact_record and reads pace with app_bench_pace', async () => {
    const execute = vi.fn(() =>
      Promise.resolve([{ minutes_per_item: '4.50' }, { minutes_per_item: 'x' }]),
    );
    const db = { execute } as never;
    await recordBenchFacts(db, {
      sourceId: 's',
      hallNo: '3',
      sittingDate: '2026-10-19',
      benchId: null,
      facts: { itemsListed: 3, itemsHeard: 2, itemsDisposed: 2, minutesPerItem: null },
    });
    expect(await loadBenchPace(db, { sourceId: 's', hallNo: '3', since: at('10:30') })).toEqual([
      4.5,
    ]);
    const text = JSON.stringify(execute.mock.calls);
    expect(text).toContain('app_bench_fact_record');
    expect(text).toContain('app_bench_pace');
    expect(text).not.toContain('bench_sitting_fact');
  });
});
