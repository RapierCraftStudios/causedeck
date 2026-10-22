// `GET /api/ics/[token]` (#53; PRD CA-5): resolve a feed token and render its calendar. The route is
// unauthenticated, so the token is the credential: its sha256 is looked up through the
// `app_ics_feed_resolve` SECURITY DEFINER function (migration 0056), compared in constant time, and
// everything else runs in the feed owner's workspace scope under row-level security. Unknown,
// revoked, flag-off and no-longer-permitted feeds are the same bodyless 404, so a caller learns
// nothing. 60 requests per hour per feed, then 429. Only confirmed canonical listings and open
// obligations of readable, non-sensitive matters are published (capture/ics/export.ts re-checks).
import { timingSafeEqual } from 'node:crypto';

import { can, isRole } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import {
  buildFeed,
  type FeedListing,
  type FeedObligation,
  type FeedState,
} from '@causedeck/capture';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq, isNotNull, ne, sql, type SQL } from 'drizzle-orm';

import {
  getRoleSettings,
  hashIntegrationToken,
  memberRole,
  toPolicySettings,
} from '../workspaces/index.ts';

const {
  courtHall,
  forum,
  icsFeed,
  icsFeedEvent,
  listing,
  matter,
  member,
  obligation,
  organization,
  proceeding,
} = schema;

/** 60 requests per hour per feed. */
export const FEED_RATE_LIMIT = { max: 60, windowSeconds: 60 * 60 } as const;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export interface ServeDeps {
  db: Database | Transaction;
  /** The app's request limiter (`consumeRequestLimit`): false when over the limit. */
  limit(key: string, limit: { max: number; windowSeconds: number }): Promise<boolean>;
  /** Whether the `capture.ics-feed` flag is on for the feed's workspace and user. */
  enabled(scope: { workspaceId: string; userId: string }): Promise<boolean>;
  /** The app's public URL, for the deep links. */
  appUrl: string;
  now?: () => Date;
}

export type ServeResult =
  | { status: 404 }
  | { status: 429; retryAfterSec: number }
  | { status: 304; etag: string }
  | { status: 200; etag: string; body: string };

type Resolved = {
  workspace_id: string;
  feed_id: string;
  user_id: string;
  token_hash: string;
  scope: 'mine' | 'workspace';
  include_parties: boolean;
};

const NOT_FOUND: ServeResult = { status: 404 };

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `If-None-Match` matches `etag` (a list, weak validators and `*` included). */
export function etagMatches(header: string | null | undefined, etag: string): boolean {
  if (header === null || header === undefined) return false;
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//, ''))
    .some((part) => part === '*' || part === etag);
}

const caseLabel = (row: {
  caseTypeRaw: string | null;
  caseTypeCode: string;
  number: string | null;
  year: number | null;
}): string => {
  const type = row.caseTypeRaw ?? row.caseTypeCode;
  return row.number === null || row.year === null
    ? type
    : `${type} ${row.number}/${String(row.year)}`;
};

const parties = (row: { petitioner: string | null; respondent: string | null }): string | null =>
  row.petitioner === null || row.respondent === null
    ? (row.petitioner ?? row.respondent)
    : `${row.petitioner} v ${row.respondent}`;

export async function serveFeed(
  deps: ServeDeps,
  request: { token: string; ifNoneMatch?: string | null },
): Promise<ServeResult> {
  if (!TOKEN_SHAPE.test(request.token)) return NOT_FOUND;
  const tokenHash = hashIntegrationToken(request.token);
  const [found] = await deps.db.execute<Resolved>(
    sql`select workspace_id::text, feed_id::text, user_id::text, token_hash, scope, include_parties from app_ics_feed_resolve(${tokenHash})`,
  );
  if (found === undefined || !sameHash(found.token_hash, tokenHash)) return NOT_FOUND;
  const { workspace_id: workspaceId, feed_id: feedId, user_id: userId } = found;
  if (!(await deps.enabled({ workspaceId, userId }))) return NOT_FOUND;
  if (!(await deps.limit(`ics:${feedId}`, FEED_RATE_LIMIT))) {
    return { status: 429, retryAfterSec: FEED_RATE_LIMIT.windowSeconds };
  }
  const now = deps.now?.() ?? new Date();

  return withWorkspace(deps.db, { workspaceId, userId }, async (tx): Promise<ServeResult> => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) return NOT_FOUND;
    if (found.scope === 'workspace' && role !== 'owner') return NOT_FOUND;
    const actor = { userId, workspaceId, role };
    if (!can(actor, 'matter.read').allow) return NOT_FOUND;
    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));

    const [workspace] = await tx
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, workspaceId));
    if (workspace === undefined) return NOT_FOUND;

    const visible: SQL = matterVisibilityPredicate(actor, matter.id, {
      settings,
      ownerUserId: member.userId,
    });
    const scopeFilter: SQL = found.scope === 'mine' ? eq(member.userId, userId) : sql`true`;
    const matterJoin = and(
      eq(matter.workspaceId, listing.workspaceId),
      eq(matter.id, proceeding.matterId),
    );

    const listingRows = await tx
      .select({
        id: listing.id,
        matterId: matter.id,
        listDate: listing.listDate,
        itemNo: listing.itemNo,
        confirmationState: listing.confirmationState,
        sensitive: matter.sensitive,
        caseTypeRaw: proceeding.caseTypeRaw,
        caseTypeCode: proceeding.caseTypeCode,
        number: proceeding.number,
        year: proceeding.year,
        court: forum.court,
        seat: forum.seat,
        hallNo: courtHall.hallNo,
        hallLabel: courtHall.label,
        petitioner: proceeding.titlePetitioner,
        respondent: proceeding.titleRespondent,
      })
      .from(listing)
      .innerJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, listing.workspaceId),
          eq(proceeding.id, listing.proceedingId),
        ),
      )
      .innerJoin(matter, matterJoin)
      .innerJoin(forum, eq(forum.id, proceeding.forumId))
      .leftJoin(courtHall, eq(courtHall.id, listing.hallId))
      .leftJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
      )
      .where(
        and(
          eq(listing.workspaceId, workspaceId),
          eq(listing.canonical, true),
          ne(listing.confirmationState, 'proposed'),
          eq(matter.sensitive, false),
          visible,
          scopeFilter,
        ),
      );
    const listings: FeedListing[] = listingRows.map((row) => ({
      id: row.id,
      matterId: row.matterId,
      listDate: row.listDate,
      itemNo: row.itemNo,
      caseLabel: caseLabel(row),
      hall: row.hallNo === null ? null : (row.hallLabel ?? `Court ${row.hallNo}`),
      forum: row.seat === null ? row.court : `${row.court}, ${row.seat}`,
      confirmationState: row.confirmationState,
      sensitive: row.sensitive,
      parties: parties(row),
    }));

    const obligationRows = await tx
      .select({
        id: obligation.id,
        matterId: matter.id,
        dueDate: obligation.dueDate,
        description: obligation.description,
        status: obligation.status,
        sensitive: matter.sensitive,
        caseTypeRaw: proceeding.caseTypeRaw,
        caseTypeCode: proceeding.caseTypeCode,
        number: proceeding.number,
        year: proceeding.year,
        petitioner: proceeding.titlePetitioner,
        respondent: proceeding.titleRespondent,
      })
      .from(obligation)
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, obligation.workspaceId), eq(matter.id, obligation.matterId)),
      )
      .leftJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, obligation.workspaceId),
          eq(proceeding.id, obligation.proceedingId),
        ),
      )
      .leftJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
      )
      .where(
        and(
          eq(obligation.workspaceId, workspaceId),
          eq(obligation.status, 'open'),
          isNotNull(obligation.dueDate),
          eq(matter.sensitive, false),
          visible,
          scopeFilter,
        ),
      );
    const obligations: FeedObligation[] = obligationRows.flatMap((row) =>
      row.dueDate === null
        ? []
        : [
            {
              id: row.id,
              matterId: row.matterId,
              dueDate: row.dueDate,
              description: row.description,
              caseLabel:
                row.caseTypeCode === null
                  ? null
                  : caseLabel({ ...row, caseTypeCode: row.caseTypeCode }),
              status: row.status,
              sensitive: row.sensitive,
              parties: parties(row),
            },
          ],
    );

    const stored = await tx
      .select()
      .from(icsFeedEvent)
      .where(and(eq(icsFeedEvent.workspaceId, workspaceId), eq(icsFeedEvent.feedId, feedId)));
    const previous: FeedState[] = stored.map((row) => ({
      uid: row.uid,
      sequence: row.sequence,
      contentHash: row.contentHash,
      changedAt: row.changedAt,
      cancelledAt: row.cancelledAt,
      snapshot: row.snapshot,
    }));

    const built = buildFeed(
      listings,
      obligations,
      previous,
      {
        includeParties: found.include_parties,
        workspaceUrl: `${deps.appUrl.replace(/\/$/, '')}/w/${workspace.slug}`,
        name: 'CauseDeck hearings',
      },
      now,
    );
    await saveState(tx, workspaceId, feedId, previous, built.nextState);
    await tx
      .update(icsFeed)
      .set({ lastFetchedAt: now })
      .where(and(eq(icsFeed.workspaceId, workspaceId), eq(icsFeed.id, feedId)));
    if (etagMatches(request.ifNoneMatch, built.etag)) return { status: 304, etag: built.etag };
    return { status: 200, etag: built.etag, body: built.body };
  });
}

/** Write only what changed: new or changed UIDs, and delete the ones whose CANCELLED window ended. */
async function saveState(
  tx: Transaction,
  workspaceId: string,
  feedId: string,
  previous: readonly FeedState[],
  next: readonly FeedState[],
): Promise<void> {
  const before = new Map(previous.map((s) => [s.uid, s]));
  const keep = new Set(next.map((s) => s.uid));
  for (const state of next) {
    const old = before.get(state.uid);
    if (
      old !== undefined &&
      old.sequence === state.sequence &&
      old.contentHash === state.contentHash &&
      (old.cancelledAt?.getTime() ?? null) === (state.cancelledAt?.getTime() ?? null)
    ) {
      continue;
    }
    await tx
      .insert(icsFeedEvent)
      .values({ workspaceId, feedId, ...state })
      .onConflictDoUpdate({
        target: [icsFeedEvent.workspaceId, icsFeedEvent.feedId, icsFeedEvent.uid],
        set: {
          sequence: state.sequence,
          contentHash: state.contentHash,
          changedAt: state.changedAt,
          cancelledAt: state.cancelledAt,
          snapshot: state.snapshot,
        },
      });
  }
  for (const old of previous) {
    if (keep.has(old.uid)) continue;
    await tx
      .delete(icsFeedEvent)
      .where(
        and(
          eq(icsFeedEvent.workspaceId, workspaceId),
          eq(icsFeedEvent.feedId, feedId),
          eq(icsFeedEvent.uid, old.uid),
        ),
      );
  }
}
