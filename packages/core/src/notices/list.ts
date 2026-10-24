// Reading the notices feed (#588, D-048): the notices matched to the caller's workspace, and those
// affecting one matter. `notice` is global but `notice_match` is tenant data, so both reads run in
// the caller's workspace scope and start from the match rows: another workspace's matches never
// appear. A notice matched through several rows (a forum and its matters) is listed once.
// Sensitive matters are left out of the matter-level matches: the page lists no matter titles, and
// a sensitive matter's link to a notice is not shown. Provenance is the source and the record date.
import { isUuid, schema, withWorkspace, type Queryable } from '@causedeck/db';
import { and, desc, eq, sql } from 'drizzle-orm';

import { notFound } from '../shared/errors.ts';

const { notice, noticeMatch, source, matter } = schema;

/** Notices returned per read; the page shows the newest. */
export const NOTICES_LIST_LIMIT = 100;

export interface NoticeActor {
  workspaceId: string;
  userId: string;
}

export interface NoticeRow {
  id: string;
  title: string;
  kind: (typeof notice.$inferSelect)['kind'];
  issuedOn: string;
  effectiveOn: string | null;
  /** The official notice URL (the source link). */
  url: string;
  forumCodes: string[];
  /** Provenance: the registered source and when the notice was recorded. */
  sourceId: string;
  sourceName: string;
  recordedAt: Date;
  /** Matters of the workspace the notice affects (`matter_forum` matches). */
  matterCount: number;
}

const columns = {
  id: notice.id,
  title: notice.title,
  kind: notice.kind,
  issuedOn: notice.issuedOn,
  effectiveOn: notice.effectiveOn,
  url: notice.url,
  forumCodes: notice.forumCodes,
  sourceId: notice.sourceId,
  sourceName: source.owner,
  recordedAt: notice.createdAt,
  matterCount: sql<number>`count(${noticeMatch.matterId})::int`,
};

/** The workspace's notices (matched to its forums or matters), newest issued first. */
export async function listWorkspaceNotices(
  db: Queryable,
  actor: NoticeActor,
): Promise<NoticeRow[]> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw notFound();
  return withWorkspace(db, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
    tx
      .select(columns)
      .from(noticeMatch)
      .innerJoin(notice, eq(notice.id, noticeMatch.noticeId))
      .innerJoin(source, eq(source.id, notice.sourceId))
      .leftJoin(
        matter,
        and(eq(matter.workspaceId, noticeMatch.workspaceId), eq(matter.id, noticeMatch.matterId)),
      )
      .where(and(eq(noticeMatch.workspaceId, actor.workspaceId), sql`coalesce(not ${matter.sensitive}, true)`))
      .groupBy(notice.id, source.owner)
      .orderBy(desc(notice.issuedOn), desc(notice.id))
      .limit(NOTICES_LIST_LIMIT),
  );
}

/** The notices affecting one matter of the workspace, newest issued first. */
export async function listMatterNotices(
  db: Queryable,
  actor: NoticeActor,
  matterId: string,
): Promise<NoticeRow[]> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId) || !isUuid(matterId)) {
    throw notFound('Matter not found');
  }
  return withWorkspace(db, { workspaceId: actor.workspaceId, userId: actor.userId }, async (tx) => {
    const found = await tx
      .select({ sensitive: matter.sensitive })
      .from(matter)
      .where(and(eq(matter.workspaceId, actor.workspaceId), eq(matter.id, matterId)))
      .limit(1);
    if (found.length === 0 || found[0]?.sensitive) throw notFound('Matter not found');
    return tx
      .select(columns)
      .from(noticeMatch)
      .innerJoin(notice, eq(notice.id, noticeMatch.noticeId))
      .innerJoin(source, eq(source.id, notice.sourceId))
      .where(and(eq(noticeMatch.workspaceId, actor.workspaceId), eq(noticeMatch.matterId, matterId)))
      .groupBy(notice.id, source.owner)
      .orderBy(desc(notice.issuedOn), desc(notice.id))
      .limit(NOTICES_LIST_LIMIT);
  });
}
