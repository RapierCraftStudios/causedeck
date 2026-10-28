// Calendar rules of the proof-of-value prompts (#86), pure so a fixed clock tests them: the day and
// the ISO week are IST (the court calendar's zone, UTC+05:30, no daylight saving), the weekly pulse
// opens on Monday morning, and the workspace's first 7 days are the baseline.

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The weekly pulse is due from this IST hour on Monday. */
export const PULSE_OPENS_HOUR_IST = 6;
/** Ratings and pulses in the workspace's first days are the baseline for the delta (#85). */
export const BASELINE_DAYS = 7;

/** The same instant shifted so its UTC fields read as IST wall-clock fields. */
function ist(at: Date): Date {
  return new Date(at.getTime() + IST_OFFSET_MS);
}

/** `YYYY-MM-DD` of the IST day containing `at`. */
export function istDay(at: Date): string {
  return ist(at).toISOString().slice(0, 10);
}

/** The instant the IST day containing `at` began. */
export function istDayStart(at: Date): Date {
  const shifted = ist(at);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(start - IST_OFFSET_MS);
}

/** `YYYY-Www`: the ISO 8601 week of the IST day containing `at`. */
export function isoWeekIst(at: Date): string {
  const shifted = ist(at);
  const day = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
  const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  // The Thursday of this week decides the ISO year.
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${String(year)}-W${String(week).padStart(2, '0')}`;
}

/**
 * Whether the week's pulse may show: from Monday 06:00 IST of the ISO week through its Sunday. The
 * first hours of Monday belong to the new week but are not yet due.
 */
export function pulseWindowOpen(at: Date): boolean {
  const shifted = ist(at);
  return !(shifted.getUTCDay() === 1 && shifted.getUTCHours() < PULSE_OPENS_HOUR_IST);
}

/** Whether `at` falls in the workspace's first {@link BASELINE_DAYS} days. */
export function isBaseline(workspaceCreatedAt: Date, at: Date): boolean {
  return at.getTime() - workspaceCreatedAt.getTime() < BASELINE_DAYS * DAY_MS;
}
