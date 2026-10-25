// Calendar schemas (#66): the range query and result of `getCalendarRange` in `@causedeck/core`
// (week and month views over listings, next dates, obligation due dates and forum closures).
// Objects are strict. Strategy-bearing fields (`stage`, `description`) are absent from clerk payloads.
import { z } from 'zod';

import { COURT_DAY_SCOPES } from './court-day';

const uuid = z.uuid();
const day = z.iso.date();

/** The widest range one call reads: six weeks, the month grid. */
export const CALENDAR_MAX_DAYS = 42;
export const CALENDAR_ENTRY_KINDS = [
  'listing',
  'next_date',
  'obligation_due',
  'holiday',
  'vacation',
] as const;

const DAY_MS = 86_400_000;

/** Days from `from` to `to`, inclusive. */
export function calendarSpanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export const CalendarRange = z
  .strictObject({
    from: day,
    to: day,
    scope: z.enum(COURT_DAY_SCOPES).default('mine'),
  })
  .refine((r) => r.to >= r.from, { message: 'to must not be before from', path: ['to'] })
  .refine((r) => calendarSpanDays(r.from, r.to) <= CALENDAR_MAX_DAYS, {
    message: `a range is at most ${CALENDAR_MAX_DAYS} days`,
    path: ['to'],
  });

/**
 * One dated entry. A restricted matter the caller may not read is `redacted`: it keeps its date and
 * kind but carries no matter id, title or label. `proposed` marks an unconfirmed date.
 */
export const CalendarEntry = z.strictObject({
  kind: z.enum(CALENDAR_ENTRY_KINDS),
  date: day,
  proposed: z.boolean(),
  redacted: z.boolean(),
  matterId: uuid.nullable(),
  matterTitle: z.string().nullable(),
  proceedingId: uuid.nullable(),
  caseLabel: z.string().nullable(),
  forumName: z.string().nullable(),
  hallNo: z.string().nullable(),
  itemNo: z.string().nullable(),
  /** A holiday or vacation name, or the obligation text (strategy-gated). */
  label: z.string().nullable(),
  /** The raw stage of a listing (strategy-gated). */
  stage: z.string().nullable().optional(),
});

export const CalendarDayCounts = z.strictObject({
  listings: z.int().nonnegative(),
  nextDates: z.int().nonnegative(),
  obligationsDue: z.int().nonnegative(),
  /** Proposed dates and unconfirmed listings: shown, never counted as commitments. */
  proposed: z.int().nonnegative(),
  /** Confirmed commitments: listings, next dates and obligations that are not proposed. */
  confirmed: z.int().nonnegative(),
});

export const CalendarDay = z.strictObject({
  date: day,
  counts: CalendarDayCounts,
  /** The same member is listed in different halls or complexes on this day. */
  clash: z.boolean(),
  /** A holiday or vacation name when a forum of the workspace is closed, else null. */
  closedReason: z.string().nullable(),
  entries: z.array(CalendarEntry),
});

export type CalendarRange = z.input<typeof CalendarRange>;
export type ParsedCalendarRange = z.output<typeof CalendarRange>;
export type CalendarEntry = z.output<typeof CalendarEntry>;
export type CalendarDayCounts = z.output<typeof CalendarDayCounts>;
export type CalendarDay = z.output<typeof CalendarDay>;
