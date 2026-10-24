// Holiday notices on the court calendar (#587, D-048): a listing is on a holiday when a `holiday`
// notice matched to the workspace names the listing's forum and takes effect on the listing's date.
// It is a read, not a stored flag, so a notice that arrives after the listing still flags it. Only a
// holiday notice with a machine-readable `effective_on` flags anything; the dates inside a holiday-list
// document are not parsed yet.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

const { forum, listing, notice, noticeMatch, proceeding } = schema;

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
        and(
          eq(notice.kind, 'holiday'),
          eq(notice.effectiveOn, listing.listDate),
          sql`${forum.code} = any(${notice.forumCodes})`,
        ),
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
        ),
      )
      .orderBy(asc(listing.listDate), asc(listing.id), asc(notice.id)),
  );
}
