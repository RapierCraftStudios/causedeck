// Court calendars for the deadline engine (#494, D-048): which days a forum is closed. Holidays come
// from the notices feed (a `holiday` notice matched to the workspace with a machine-readable
// `effective_on` or dates read from its document in `notice_holiday`, the same read as `listHolidayListings`).
// Vacations are ranges: those a matched notice states live in `notice_vacation` (#650) and are merged
// with the static per-forum table below by `mergeVacations`. Weekly offs default to Sunday.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

const { notice, noticeHoliday, noticeMatch, noticeVacation } = schema;

export interface VacationRange {
  /** First closed day (ISO date), inclusive. */
  from: string;
  /** Last closed day (ISO date), inclusive. */
  to: string;
  name: string;
}

export interface CourtCalendar {
  forumCode: string;
  /** Days of the week the court never sits (0 = Sunday ... 6 = Saturday). */
  weeklyOffs: readonly number[];
  /** Holiday dates (ISO) with the notice title that names them. */
  holidays: ReadonlyMap<string, string>;
  vacations: readonly VacationRange[];
}

/** Sunday only: Saturday sittings differ by forum, so a Saturday is off only when a calendar says so. */
export const DEFAULT_WEEKLY_OFFS: readonly number[] = Object.freeze([0]);

/**
 * Counsel-reviewed vacation ranges by forum code. Empty until counsel signs the dates off; rows are
 * added here (not guessed) and a caller can pass its own ranges to `loadCourtCalendar`.
 */
export const FORUM_VACATIONS: Readonly<Record<string, readonly VacationRange[]>> = Object.freeze(
  {},
);

/**
 * Vacation precedence (#650). The static table is the counsel-reviewed baseline; a matched notice is
 * the court's own latest word, so it wins where the two disagree:
 * 1. A notice-derived range replaces every static range it overlaps (shares at least one day), so a
 *    court that moves its vacation does not leave the old dates closed.
 * 2. A static range that overlaps no notice-derived range stays: parsing falls back to the table.
 * 3. Notice-derived ranges are all kept (two notices that overlap each other both close their days).
 * The result is sorted by start date. This only merges ranges; it encodes no Limitation Act rule.
 */
export function mergeVacations(
  staticRanges: readonly VacationRange[],
  noticeRanges: readonly VacationRange[],
): VacationRange[] {
  const kept = staticRanges.filter(
    (s) => !noticeRanges.some((n) => n.from <= s.to && s.from <= n.to),
  );
  return [...kept, ...noticeRanges].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
}

/** Why the court is closed on `date` (ISO), or null when it sits. */
export function closedReason(calendar: CourtCalendar, date: string): string | null {
  const holiday = calendar.holidays.get(date);
  if (holiday !== undefined) return holiday;
  const vacation = calendar.vacations.find((v) => v.from <= date && date <= v.to);
  if (vacation !== undefined) return vacation.name;
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return calendar.weeklyOffs.includes(weekday) ? 'weekly off' : null;
}

export interface LoadCourtCalendarInput {
  forumCode: string;
  /** First day (ISO date), inclusive. */
  from: string;
  /** Last day (ISO date), inclusive. */
  to: string;
  /** The caller's own ranges: when given they are the whole vacation list (no notices, no table). */
  vacations?: readonly VacationRange[];
  weeklyOffs?: readonly number[];
}

/** The calendar of one forum from the holiday notices matched to the workspace. */
export async function loadCourtCalendar(
  db: Database | Transaction,
  workspaceId: string,
  input: LoadCourtCalendarInput,
): Promise<CourtCalendar> {
  const fetched = await withWorkspace(db, { workspaceId }, async (tx) => {
    const matched = and(
      eq(noticeMatch.workspaceId, workspaceId),
      eq(noticeMatch.noticeId, notice.id),
    );
    const forumHoliday = and(
      eq(notice.kind, 'holiday'),
      sql`${input.forumCode} = any(${notice.forumCodes})`,
    );
    const single = await tx
      .selectDistinct({ effectiveOn: notice.effectiveOn, title: notice.title, id: notice.id })
      .from(notice)
      .innerJoin(noticeMatch, matched)
      .where(
        and(forumHoliday, gte(notice.effectiveOn, input.from), lte(notice.effectiveOn, input.to)),
      );
    // The dates the poll read out of the holiday-list document (#628), named as printed.
    const listed = await tx
      .selectDistinct({
        effectiveOn: noticeHoliday.holidayOn,
        title: noticeHoliday.name,
        id: notice.id,
      })
      .from(notice)
      .innerJoin(noticeMatch, matched)
      .innerJoin(noticeHoliday, eq(noticeHoliday.noticeId, notice.id))
      .where(
        and(
          forumHoliday,
          gte(noticeHoliday.holidayOn, input.from),
          lte(noticeHoliday.holidayOn, input.to),
        ),
      );
    // Vacation ranges the notice states (#650) that touch [from, to].
    const ranges = await tx
      .selectDistinct({
        from: noticeVacation.fromOn,
        to: noticeVacation.toOn,
        name: noticeVacation.name,
      })
      .from(notice)
      .innerJoin(noticeMatch, matched)
      .innerJoin(noticeVacation, eq(noticeVacation.noticeId, notice.id))
      .where(
        and(
          forumHoliday,
          lte(noticeVacation.fromOn, input.to),
          gte(noticeVacation.toOn, input.from),
        ),
      );
    return {
      rows: [...single, ...listed].sort(
        (x, y) =>
          (x.effectiveOn ?? '').localeCompare(y.effectiveOn ?? '') || x.id.localeCompare(y.id),
      ),
      ranges,
    };
  });
  const { rows, ranges } = fetched;
  const holidays = new Map<string, string>();
  for (const row of rows) {
    if (row.effectiveOn !== null && !holidays.has(row.effectiveOn)) {
      holidays.set(row.effectiveOn, row.title);
    }
  }
  return {
    forumCode: input.forumCode,
    weeklyOffs: input.weeklyOffs ?? DEFAULT_WEEKLY_OFFS,
    holidays,
    vacations: input.vacations ?? mergeVacations(FORUM_VACATIONS[input.forumCode] ?? [], ranges),
  };
}
