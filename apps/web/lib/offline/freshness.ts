// Freshness rules for the offline cache (#65, ADR-0042). Pure functions with `now` injected, so the
// rolling window and staleness are testable without a clock. A day is a `YYYY-MM-DD` string in the
// advocate's court timezone, which is how `courtDay` rows are keyed.

/** Cached data older than this is shown with a "may be out of date" notice. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const COURT_TIME_ZONE = 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Epoch ms stamped on a row when it is written; the only time the cache stores in the clear. */
export function stampSavedAt(now: number): number {
  return now;
}

/** `YYYY-MM-DD` of an instant in the court timezone. */
export function courtDate(now: number, timeZone: string = COURT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

/** `date` shifted by whole days, calendar arithmetic on the string (no timezone involved). */
export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

export function isStale(savedAt: number, now: number, maxAgeMs: number = STALE_AFTER_MS): boolean {
  return now - savedAt > maxAgeMs;
}

/** The rolling window keeps yesterday, today and later; anything older is evicted. */
export function windowStart(today: string): string {
  return addDays(today, -1);
}

export function isInWindow(date: string, today: string): boolean {
  return date >= windowStart(today);
}

/** The days among `dates` that fall out of the rolling window. */
export function evictableDays(dates: readonly string[], today: string): string[] {
  return dates.filter((date) => !isInWindow(date, today));
}
