// Usage periods (#219): IST calendar months. Asia/Kolkata has had a fixed +05:30 offset with no
// daylight saving since 1945, so the boundaries are plain offset arithmetic. A period is stored as
// its start instant (`usage_counter.period_start`), e.g. April 2026 starts 2026-03-31T18:30:00Z.

export const USAGE_TIME_ZONE = 'Asia/Kolkata';
export const IST_OFFSET_MINUTES = 330;

const OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/** One IST calendar month: `start` inclusive, `end` exclusive. */
export interface UsagePeriod {
  start: Date;
  end: Date;
}

function checked(at: Date): number {
  const ms = at instanceof Date ? at.getTime() : Number.NaN;
  if (Number.isNaN(ms)) throw new TypeError('usage period: invalid date');
  return ms;
}

/** The instant 00:00 IST on the first of the month `delta` months after the IST month of `at`. */
function monthStart(at: Date, delta: number): Date {
  const local = new Date(checked(at) + OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + delta, 1) - OFFSET_MS);
}

/** Start of the IST calendar month containing `at`. */
export function periodStart(at: Date): Date {
  return monthStart(at, 0);
}

/** Start of the IST calendar month after the one containing `at`. */
export function nextPeriodStart(at: Date): Date {
  return monthStart(at, 1);
}

/** The IST calendar month containing `at`. */
export function usagePeriod(at: Date): UsagePeriod {
  return { start: periodStart(at), end: nextPeriodStart(at) };
}
