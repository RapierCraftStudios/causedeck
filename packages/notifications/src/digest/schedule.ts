// The end-of-day digest schedule (#49): when it goes out and which local day it covers. Pure date
// maths in a named time zone (the workspace's, default `Asia/Kolkata`); no database. The scheduler
// fires every 30 minutes from 18:00 to 23:00 and a member's digest goes out in the slot that
// equals their configured time (default 20:30; :00 or :30, 18:00-23:00).
export const END_OF_DAY_ZONE = 'Asia/Kolkata';
export const DEFAULT_END_OF_DAY_TIME = '20:30';
const FIRST_MINUTE = 18 * 60;
const LAST_MINUTE = 23 * 60;
const SLOT_MINUTES = 30;

/** `HH:MM` on :00 or :30 within 18:00-23:00 (the range that respects deploy-freeze windows). */
export function isEndOfDayTime(value: string): boolean {
  if (!/^\d{2}:(00|30)$/.test(value)) return false;
  const minutes = Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return minutes >= FIRST_MINUTE && minutes <= LAST_MINUTE;
}

function zoneParts(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const out: Record<string, number> = {};
  for (const part of parts) if (part.type !== 'literal') out[part.type] = Number(part.value);
  return out;
}

/** Local calendar date `YYYY-MM-DD` of `date` in `timeZone`. */
export function localDateOf(date: Date, timeZone: string = END_OF_DAY_ZONE): string {
  const p = zoneParts(date, timeZone);
  const pad = (n: number | undefined, width: number) => String(n ?? 0).padStart(width, '0');
  return `${pad(p['year'], 4)}-${pad(p['month'], 2)}-${pad(p['day'], 2)}`;
}

export interface EndOfDaySlot {
  /** The local day the digest covers. */
  localDate: string;
  /** `HH:MM` of the half hour `now` falls in. */
  slot: string;
}

/** The slot `now` falls in when it is inside 18:00-23:00 local time, else `null`. */
export function endOfDaySlot(now: Date, timeZone: string = END_OF_DAY_ZONE): EndOfDaySlot | null {
  const p = zoneParts(now, timeZone);
  const minutes = (p['hour'] ?? 0) * 60 + (p['minute'] ?? 0);
  if (minutes < FIRST_MINUTE || minutes > LAST_MINUTE + SLOT_MINUTES - 1) return null;
  const floored = Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES;
  if (floored > LAST_MINUTE) return null;
  const hh = String(Math.floor(floored / 60)).padStart(2, '0');
  const mm = String(floored % 60).padStart(2, '0');
  return { localDate: localDateOf(now, timeZone), slot: `${hh}:${mm}` };
}

/** The instant of `localDate` at 00:00 in `timeZone`. */
function startOfLocalDay(localDate: string, timeZone: string): Date {
  const [y = 1970, m = 1, d = 1] = localDate.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const p = zoneParts(new Date(guess), timeZone);
  const wall = Date.UTC(
    p['year'] ?? y,
    (p['month'] ?? m) - 1,
    p['day'] ?? d,
    p['hour'],
    p['minute'],
  );
  return new Date(guess - (wall - guess));
}

/** `[start, end)` of a local calendar day in `timeZone`. */
export function localDayBounds(
  localDate: string,
  timeZone: string = END_OF_DAY_ZONE,
): { start: Date; end: Date } {
  const [y = 1970, m = 1, d = 1] = localDate.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start: startOfLocalDay(localDate, timeZone), end: startOfLocalDay(next, timeZone) };
}
