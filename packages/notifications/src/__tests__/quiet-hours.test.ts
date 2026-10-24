// Quiet hours (#196): with `Do not push during court hours` on, 10:30-17:00 local is quiet.
import { describe, expect, it } from 'vitest';

import { COURT_HOURS, isQuietTime, localMinutes } from '../quiet-hours.ts';

const at = (hh: number, mm: number) => hh * 60 + mm;

describe('quiet hours', () => {
  it('has no quiet hours without the setting or with it off', () => {
    expect(isQuietTime(at(11, 0), undefined)).toBe(false);
    expect(isQuietTime(at(11, 0), { courtHoursQuiet: false })).toBe(false);
  });

  it('makes court hours quiet when the setting is on', () => {
    const on = { courtHoursQuiet: true };
    expect(COURT_HOURS).toEqual({ start: '10:30', end: '17:00' });
    expect(isQuietTime(at(10, 29), on)).toBe(false);
    expect(isQuietTime(at(10, 30), on)).toBe(true);
    expect(isQuietTime(at(16, 59), on)).toBe(true);
    expect(isQuietTime(at(17, 0), on)).toBe(false);
    // The 18:30 digest is outside court hours.
    expect(isQuietTime(at(18, 30), on)).toBe(false);
  });

  it('reads local minutes in a time zone', () => {
    const instant = new Date('2026-10-19T13:00:00Z');
    expect(localMinutes(instant, 'Asia/Kolkata')).toBe(at(18, 30));
    expect(localMinutes(instant, 'UTC')).toBe(at(13, 0));
  });
});
