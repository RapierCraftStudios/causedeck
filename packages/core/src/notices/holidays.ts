// Holiday notices on the court calendar (#587, D-048): a listing is on a holiday when a `holiday`
// notice matched to the workspace names the listing's forum and takes effect on the listing's date.
// It is a read, not a stored flag, so a notice that arrives after the listing still flags it. A holiday
// notice flags the date of its machine-readable `effective_on` and every date of its `notice_holiday`
// rows, the dates the poll read out of a holiday-list document (#628).
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq, gte, isNotNull, lte, or, sql } from 'drizzle-orm';

const { forum, listing, notice, noticeHoliday, noticeMatch, proceeding } = schema;

export interface HolidayListing {
  listingId: string;
  proceedingId: string;
  matterId: string;
  /** ISO date of the listing, equal to the holiday's date. */
  listDate: string;
  noticeId: string;
  noticeTitle: string;
}

export interface HolidayListingsRange {
  /** First day (ISO date), inclusive. */
  from: string;
  /** Last day (ISO date), inclusive. */
  to: string;
}

/** The workspace's listings in `range` that fall on a holiday named by a matched notice. */
export async function listHolidayListings(
  db: Database | Transaction,
  workspaceId: string,
  range: HolidayListingsRange,
): Promise<HolidayListing[]> {
  return withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .selectDistinct({
        listingId: listing.id,
        proceedingId: listing.proceedingId,
        matterId: proceeding.matterId,
        listDate: listing.listDate,
        noticeId: notice.id,
        noticeTitle: notice.title,
      })
      .from(listing)
      .innerJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, listing.workspaceId),
          eq(proceeding.id, listing.proceedingId),
        ),
      )
      .innerJoin(forum, eq(forum.id, proceeding.forumId))
      .innerJoin(
        notice,
        and(eq(notice.kind, 'holiday'), sql`${forum.code} = any(${notice.forumCodes})`),
      )
      .leftJoin(
        noticeHoliday,
        and(eq(noticeHoliday.noticeId, notice.id), eq(noticeHoliday.holidayOn, listing.listDate)),
      )
      .innerJoin(
        noticeMatch,
        and(eq(noticeMatch.workspaceId, listing.workspaceId), eq(noticeMatch.noticeId, notice.id)),
      )
      .where(
        and(
          eq(listing.workspaceId, workspaceId),
          gte(listing.listDate, range.from),
          lte(listing.listDate, range.to),
          or(eq(notice.effectiveOn, listing.listDate), isNotNull(noticeHoliday.id)),
        ),
      )
      .orderBy(asc(listing.listDate), asc(listing.id), asc(notice.id)),
  );
}
