import { describe, expect, it } from 'vitest';

import { inCourtDayWindow, updateDecision } from '../../lib/pwa/update-policy.ts';

/** A UTC instant for a wall-clock time in IST (UTC+5:30). */
const ist = (hours: number, minutes: number) =>
  new Date(Date.UTC(2026, 9, 22, hours, minutes) - 5.5 * 60 * 60 * 1000);

describe('update policy (#50)', () => {
  it.each([
    [7, 0],
    [9, 15],
    [10, 29],
    [18, 0],
    [22, 59],
  ])('is a court-day window at %i:%i IST', (hours, minutes) => {
    expect(inCourtDayWindow(ist(hours, minutes))).toBe(true);
  });

  it.each([
    [6, 59],
    [10, 30],
    [14, 0],
    [17, 59],
    [23, 0],
    [3, 0],
  ])('is outside the windows at %i:%i IST', (hours, minutes) => {
    expect(inCourtDayWindow(ist(hours, minutes))).toBe(false);
  });

  it('never offers "Update now" or applies the update inside a window', () => {
    expect(updateDecision(ist(8, 0))).toEqual({ offerUpdateNow: false, applyOnNavigation: false });
  });

  it('offers "Update now" and applies on the next navigation outside the windows', () => {
    expect(updateDecision(ist(12, 0))).toEqual({ offerUpdateNow: true, applyOnNavigation: true });
  });

  it('reads the clock in IST whatever the device zone', () => {
    // 02:00 UTC is 07:30 IST: inside the morning window.
    expect(inCourtDayWindow(new Date('2026-10-22T02:00:00Z'))).toBe(true);
    // 05:00 UTC is 10:30 IST: the window has just closed.
    expect(inCourtDayWindow(new Date('2026-10-22T05:00:00Z'))).toBe(false);
  });
});
