import { describe, expect, it } from 'vitest';

import { getPlan, type Plan } from '../plans';
import { prorateSeatIncrease, roundHalfUpDiv } from '../proration';
import { addInterval } from '../provider';

const DAY = 86_400;
const chamber = getPlan('chamber-seat-1') as Plan; // 49_900 per seat, clerk seat 19_900
const advocate = getPlan('advocate-monthly-1') as Plan;

const unix = (iso: string) => Date.parse(iso) / 1000;
const at = (s: number) => new Date(s * 1000);

/** A period from `iso` of one plan interval, built with the provider's month arithmetic. */
function period(iso: string, interval: 'month' | 'year' = 'month') {
  const start = unix(iso);
  return { start, end: addInterval(start, interval) };
}

function prorate(p: { start: number; end: number }, atSeconds: number, seats = 1, clerk = 0) {
  return prorateSeatIncrease({
    plan: chamber,
    from: { seats: 3, clerkSeats: 0 },
    to: { seats: 3 + seats, clerkSeats: clerk },
    periodStart: at(p.start),
    periodEnd: at(p.end),
    at: at(atSeconds),
  });
}

/** Reference: round half up of n/d computed independently with bigint floor division. */
const expected = (n: bigint, d: bigint) => {
  const q = n / d;
  return Number(2n * (n - q * d) >= d ? q + 1n : q);
};

describe('roundHalfUpDiv', () => {
  it.each([
    [5n, 2n, 3n],
    [3n, 2n, 2n],
    [1n, 3n, 0n],
    [2n, 3n, 1n],
    [0n, 7n, 0n],
    [6n, 3n, 2n],
  ])('%i / %i = %i', (n, d, q) => {
    expect(roundHalfUpDiv(n, d)).toBe(q);
  });

  it('rejects negative or zero operands', () => {
    expect(() => roundHalfUpDiv(-1n, 2n)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(1n, 0n)).toThrow(RangeError);
  });
});

describe('prorateSeatIncrease over real period lengths', () => {
  it.each([
    ['February 2026 (28 days)', '2026-02-01T00:00:00Z', 28],
    ['February 2028 (29 days, leap)', '2028-02-01T00:00:00Z', 29],
    ['April 2026 (30 days)', '2026-04-01T00:00:00Z', 30],
    ['January 2026 (31 days)', '2026-01-01T00:00:00Z', 31],
  ])('%s', (_label, iso, days) => {
    const p = period(iso);
    expect(p.end - p.start).toBe(days * DAY);

    // Ten days in: one added seat for the remaining (days - 10) days.
    const result = prorate(p, p.start + 10 * DAY);
    expect(result.periodSeconds).toBe(days * DAY);
    expect(result.remainingSeconds).toBe((days - 10) * DAY);
    expect(result.amountPaise).toBe(expected(BigInt(49_900 * (days - 10)), BigInt(days)));

    // At the first second, the full price; at the end, nothing.
    expect(prorate(p, p.start).amountPaise).toBe(49_900);
    expect(prorate(p, p.end).amountPaise).toBe(0);
    // One second before the end: 49_900 / (days × 86_400) rounds to 0.
    expect(prorate(p, p.end - 1).amountPaise).toBe(0);
  });

  it('pins hand-computed amounts', () => {
    // 49_900 × 18 / 28 = 32_078.57 → 32_079; 49_900 × 19 / 29 = 32_693.10 → 32_693.
    expect(prorate(period('2026-02-01T00:00:00Z'), unix('2026-02-11T00:00:00Z')).amountPaise).toBe(
      32_079,
    );
    expect(prorate(period('2028-02-01T00:00:00Z'), unix('2028-02-11T00:00:00Z')).amountPaise).toBe(
      32_693,
    );
  });

  it('rounds an exact half paise up', () => {
    // 1 paise seat, half the period left: 0.5 → 1.
    const p = period('2026-04-01T00:00:00Z');
    const result = prorateSeatIncrease({
      plan: { pricePaise: 1, clerkSeatPricePaise: null },
      from: { seats: 1, clerkSeats: 0 },
      to: { seats: 2, clerkSeats: 0 },
      periodStart: at(p.start),
      periodEnd: at(p.end),
      at: at(p.start + 15 * DAY),
    });
    expect(result.amountPaise).toBe(1);
    // 49_900 × 3 / 2 = 74_850 exactly; 49_899 × 1 / 2 = 24_949.5 → 24_950.
    expect(prorate(p, p.start + 15 * DAY, 3).amountPaise).toBe(74_850);
    const odd = prorateSeatIncrease({
      plan: { pricePaise: 49_899, clerkSeatPricePaise: null },
      from: { seats: 1, clerkSeats: 0 },
      to: { seats: 2, clerkSeats: 0 },
      periodStart: at(p.start),
      periodEnd: at(p.end),
      at: at(p.start + 15 * DAY),
    });
    expect(odd.amountPaise).toBe(24_950);
  });

  it('prorates an annual period across 29 February 2028 (366 days)', () => {
    const p = period('2027-06-01T00:00:00Z', 'year');
    expect(p.end - p.start).toBe(366 * DAY);
    const result = prorateSeatIncrease({
      plan: getPlan('advocate-annual-1') as Plan,
      from: { seats: 1, clerkSeats: 0 },
      to: { seats: 2, clerkSeats: 0 },
      periodStart: at(p.start),
      periodEnd: at(p.end),
      at: at(p.start + 100 * DAY),
    });
    // 499_000 × 266 / 366 = 362_661.20 → 362_661.
    expect(result.amountPaise).toBe(362_661);
  });

  it('sums the seat and clerk-seat lines, each rounded on its own', () => {
    const p = period('2026-01-01T00:00:00Z');
    const result = prorate(p, p.start + 10 * DAY, 2, 1);
    // seats: 99_800 × 21 / 31 = 67_606.45 → 67_606; clerk: 19_900 × 21 / 31 = 13_480.65 → 13_481.
    expect(result.lines).toEqual([
      { kind: 'seat', quantity: 2, unitPricePaise: 49_900, amountPaise: 67_606 },
      { kind: 'clerk_seat', quantity: 1, unitPricePaise: 19_900, amountPaise: 13_481 },
    ]);
    expect(result.amountPaise).toBe(67_606 + 13_481);
  });

  it('charges nothing for a decrease', () => {
    const p = period('2026-01-01T00:00:00Z');
    const result = prorateSeatIncrease({
      plan: chamber,
      from: { seats: 5, clerkSeats: 2 },
      to: { seats: 3, clerkSeats: 1 },
      periodStart: at(p.start),
      periodEnd: at(p.end),
      at: at(p.start + DAY),
    });
    expect(result.amountPaise).toBe(0);
    expect(result.lines.every((l) => l.quantity === 0 && l.amountPaise === 0)).toBe(true);
  });

  it('rejects a change outside the period or an empty period', () => {
    const p = period('2026-01-01T00:00:00Z');
    expect(() => prorate(p, p.start - 1)).toThrow(RangeError);
    expect(() => prorate(p, p.end + 1)).toThrow(RangeError);
    expect(() => prorate({ start: p.start, end: p.start }, p.start)).toThrow(RangeError);
  });

  it('rejects clerk seats on a plan without them', () => {
    const p = period('2026-01-01T00:00:00Z');
    expect(() =>
      prorateSeatIncrease({
        plan: advocate,
        from: { seats: 1, clerkSeats: 0 },
        to: { seats: 1, clerkSeats: 1 },
        periodStart: at(p.start),
        periodEnd: at(p.end),
        at: at(p.start),
      }),
    ).toThrow(RangeError);
  });

  it('always returns safe integer paise', () => {
    const p = period('2028-02-01T00:00:00Z');
    for (let s = p.start; s <= p.end; s += 3_607) {
      const result = prorate(p, s, 7, 3);
      expect(Number.isSafeInteger(result.amountPaise)).toBe(true);
      for (const line of result.lines) expect(Number.isSafeInteger(line.amountPaise)).toBe(true);
    }
  });
});
