// Calendar helpers of the practice insights (#85), pure: IST days as `YYYY-MM-DD` strings, the
// range the picker chose and the equal range just before it (for "four weeks ago").
import {
  INSIGHTS_MAX_RANGE_DAYS,
  type InsightsQuery,
  type InsightsWindow,
} from '@causedeck/validators/insights';

import { invalid } from '../shared/errors.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}

function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** `day` moved by `delta` calendar days. */
export function addDays(day: string, delta: number): string {
  return fromDayNumber(dayNumber(day) + delta);
}

/** Inclusive length of the window in days. */
export function windowDays(window: InsightsWindow): number {
  return dayNumber(window.to) - dayNumber(window.from) + 1;
}

/** The instant an IST day begins. */
export function istStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

/** The instant after an IST day ends (exclusive upper bound). */
export function istEnd(day: string): Date {
  return istStart(addDays(day, 1));
}

/** The window a validated query means, `today` being the IST day of the clock. */
export function resolveWindow(query: InsightsQuery, today: string): InsightsWindow {
  if (query.range === 'custom') {
    const from = query.from as string;
    const to = query.to as string;
    const window = { from, to };
    if (windowDays(window) > INSIGHTS_MAX_RANGE_DAYS) throw invalid('The range is too long');
    return window;
  }
  const weeks = query.range === '4w' ? 4 : 12;
  return { from: addDays(today, 1 - weeks * 7), to: today };
}

/** The window of equal length that ends the day before `window` begins. */
export function previousWindow(window: InsightsWindow): InsightsWindow {
  const days = windowDays(window);
  const to = addDays(window.from, -1);
  return { from: addDays(to, 1 - days), to };
}
