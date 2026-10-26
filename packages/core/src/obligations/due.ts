// Date arithmetic for obligations (#67; ADR 0043): the local day in the workspace's zone (IST by
// default), the queue group of a due date and a follow-up date with an optional working-day hook.
// Due dates come from a person or from a document; nothing here derives one from a legal rule
// (limitation periods live in #84 behind a flag), it only moves calendar days.
import type { QueueGroup } from '@causedeck/validators/obligation';

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of `now` in `timeZone`. */
export function localDay(now: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const toUtc = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** `day` moved by `days` calendar days. */
export function addDays(day: string, days: number): string {
  return new Date(toUtc(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** True when `day` is a working day; the default skips Sundays only (no holiday calendar here). */
export type WorkingDayHook = (day: string) => boolean;
export const notSunday: WorkingDayHook = (day) => new Date(toUtc(day)).getUTCDay() !== 0;

/** The first working day on or after `day`. */
export function onOrAfterWorkingDay(day: string, isWorkingDay: WorkingDayHook = notSunday): string {
  let current = day;
  for (let i = 0; i < 14 && !isWorkingDay(current); i++) current = addDays(current, 1);
  return current;
}

/** The last day of the week (Sunday) containing `today`; the week runs Monday to Sunday. */
export function weekEnd(today: string): string {
  const weekday = new Date(toUtc(today)).getUTCDay();
  return addDays(today, weekday === 0 ? 0 : 7 - weekday);
}

/** The queue group of an open obligation due on `due`. */
export function queueGroup(due: string | null, today: string): QueueGroup {
  if (due === null) return 'undated';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return due <= weekEnd(today) ? 'this_week' : 'later';
}
