// The pure date maths of a limitation computation (#940). No database, no clock, no model: the
// same rule, start date and excluded days always give the same last day to file.
import type { LimitationPeriodUnit } from '@causedeck/validators/limitation';

const DAY_MS = 86_400_000;

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `day` plus `n` calendar days. */
export function addDays(day: string, n: number): string {
  return formatDay(new Date(parseDay(day).getTime() + n * DAY_MS));
}

/** `day` plus whole months, clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: string, n: number): string {
  const start = parseDay(day);
  const total = start.getUTCFullYear() * 12 + start.getUTCMonth() + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatDay(new Date(Date.UTC(year, month, Math.min(start.getUTCDate(), last))));
}

/**
 * The last day to file: the period runs from the start date, the start day itself not counted,
 * so it ends on the same date one period later (`2026-01-10` + 30 days = `2026-02-09` is the
 * 30th day after). Excluded days extend it.
 */
export function computeExpiry(
  startDate: string,
  periodValue: number,
  periodUnit: LimitationPeriodUnit,
  excludedDays = 0,
): string {
  const end =
    periodUnit === 'days'
      ? addDays(startDate, periodValue)
      : addMonths(startDate, periodUnit === 'months' ? periodValue : periodValue * 12);
  return addDays(end, excludedDays);
}
