// IST calendar-month periods (#219): boundaries at 00:00 IST (18:30 UTC the day before).
import { describe, expect, it } from 'vitest';

import { nextPeriodStart, periodStart, usagePeriod } from '../period.ts';

const iso = (d: Date) => d.toISOString();

describe('usage periods: IST calendar months', () => {
  it('counts 2026-03-31 23:59 IST in March and 00:00 IST 1 April in April', () => {
    const march = usagePeriod(new Date('2026-03-31T23:59:00+05:30'));
    expect(iso(march.start)).toBe('2026-02-28T18:30:00.000Z');
    expect(iso(march.end)).toBe('2026-03-31T18:30:00.000Z');
    const april = usagePeriod(new Date('2026-04-01T00:00:00+05:30'));
    expect(iso(april.start)).toBe('2026-03-31T18:30:00.000Z');
    expect(iso(april.end)).toBe('2026-04-30T18:30:00.000Z');
  });

  it('splits at 18:30 UTC, not at UTC midnight', () => {
    expect(iso(periodStart(new Date('2026-03-31T18:29:59.999Z')))).toBe('2026-02-28T18:30:00.000Z');
    expect(iso(periodStart(new Date('2026-03-31T18:30:00.000Z')))).toBe('2026-03-31T18:30:00.000Z');
    // 1 April 02:00 IST is still 31 March in UTC.
    expect(iso(periodStart(new Date('2026-03-31T20:30:00Z')))).toBe('2026-03-31T18:30:00.000Z');
    // 1 April 00:00 UTC is 05:30 IST on 1 April.
    expect(iso(periodStart(new Date('2026-04-01T00:00:00Z')))).toBe('2026-03-31T18:30:00.000Z');
  });

  it('rolls over the year', () => {
    expect(iso(periodStart(new Date('2026-12-31T18:29:59.999Z')))).toBe('2026-11-30T18:30:00.000Z');
    const january = usagePeriod(new Date('2026-12-31T18:30:00Z'));
    expect(iso(january.start)).toBe('2026-12-31T18:30:00.000Z');
    expect(iso(january.end)).toBe('2027-01-31T18:30:00.000Z');
  });

  it('handles a leap-year February', () => {
    const feb = usagePeriod(new Date('2028-02-29T23:59:59+05:30'));
    expect(iso(feb.start)).toBe('2028-01-31T18:30:00.000Z');
    expect(iso(feb.end)).toBe('2028-02-29T18:30:00.000Z');
    expect(iso(periodStart(new Date('2028-03-01T00:00:00+05:30')))).toBe(
      '2028-02-29T18:30:00.000Z',
    );
  });

  it('chains every month of 2026 end to start', () => {
    let at = new Date('2026-01-01T00:00:00+05:30');
    for (let month = 1; month <= 12; month++) {
      const period = usagePeriod(at);
      const label = `2026-${String(month).padStart(2, '0')}`;
      expect(iso(period.start), label).toBe(iso(at));
      expect(iso(nextPeriodStart(at)), label).toBe(iso(period.end));
      at = period.end;
    }
    expect(iso(at)).toBe(iso(new Date('2027-01-01T00:00:00+05:30')));
  });

  it('rejects an invalid date', () => {
    expect(() => usagePeriod(new Date('nope'))).toThrow(TypeError);
    expect(() => periodStart(new Date(Number.NaN))).toThrow(TypeError);
  });
});
