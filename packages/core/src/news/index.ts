// The legal news digest service (#481, D-048). `news_item` is global (feed-provided headline, link,
// date, capped excerpt, tags and provenance; no body column); `news_pref` is the member's own row
// (practice areas, forums, digest time) under FORCE RLS. Reads join the source registry for the
// attribution (`source.owner`), so every item carries who published it and a link to the original.
import { db as appDb, schema, withWorkspace, type Queryable } from '@causedeck/db';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';

const { member, newsItem, newsPref, organization, source } = schema;

export const NEWS_PRACTICE_AREAS = schema.NEWS_PRACTICE_AREAS;
export const NEWS_FORUMS = schema.NEWS_FORUMS;
export type NewsPracticeArea = schema.NewsPracticeArea;
export type NewsForum = schema.NewsForum;
export type NewsTags = schema.NewsTags;

export const DEFAULT_NEWS_DIGEST_TIME = '07:30';
/** Items in one digest. */
export const NEWS_DIGEST_MAX_ITEMS = 10;

export type NewsErrorCode = 'FORBIDDEN' | 'INVALID';

export class NewsError extends Error {
  constructor(
    readonly code: NewsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NewsError';
  }
}

/** `HH:00` or `HH:30`, the half hours the digest scheduler fires in. */
export function isNewsDigestTime(value: string): boolean {
  return /^([01]\d|2[0-3]):(00|30)$/.test(value);
}

export interface NewsItemInput {
  sourceId: string;
  title: string;
  url: string;
  publishedAt: Date;
  excerpt: string | null;
  tags: NewsTags;
  provenance: { sha256: string; fetchedAt: Date; sourceVersion: string };
}

const capExcerpt = (excerpt: string | null): string | null =>
  excerpt === null ? null : Array.from(excerpt).slice(0, schema.NEWS_EXCERPT_MAX).join('');

/**
 * Store polled items, idempotent on `(source_id, url)`: a repeat poll refreshes the headline,
 * excerpt, tags and provenance of the row and never adds a second one. Returns the rows written.
 */
export async function upsertNewsItems(
  db: Queryable,
  items: readonly NewsItemInput[],
): Promise<number> {
  let written = 0;
  for (const item of items) {
    const values = {
      sourceId: item.sourceId,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      excerpt: capExcerpt(item.excerpt),
      tags: item.tags,
      provenanceSha256: item.provenance.sha256,
      provenanceFetchedAt: item.provenance.fetchedAt,
      provenanceSourceVersion: item.provenance.sourceVersion,
    };
    const rows = await db
      .insert(newsItem)
      .values(values)
      .onConflictDoUpdate({
        target: [newsItem.sourceId, newsItem.url],
        set: {
          title: values.title,
          publishedAt: values.publishedAt,
          excerpt: values.excerpt,
          tags: values.tags,
          provenanceSha256: values.provenanceSha256,
          provenanceFetchedAt: values.provenanceFetchedAt,
          provenanceSourceVersion: values.provenanceSourceVersion,
        },
      })
      .returning({ id: newsItem.id });
    written += rows.length;
  }
  return written;
}

export interface NewsContext {
  db: Queryable;
  workspaceId: string;
}

export interface NewsPreference {
  practiceAreas: NewsPracticeArea[];
  forums: NewsForum[];
  digestTime: string;
  lastDigestDate: string | null;
}

const uuid = z.uuid();
const prefInput = z.strictObject({
  userId: uuid,
  practiceAreas: z.array(z.enum(schema.NEWS_PRACTICE_AREAS)).max(schema.NEWS_PRACTICE_AREAS.length),
  forums: z.array(z.enum(schema.NEWS_FORUMS)).max(schema.NEWS_FORUMS.length),
  digestTime: z.string().refine(isNewsDigestTime, 'digestTime must be HH:00 or HH:30'),
});

function parse<T>(schemaOf: z.ZodType<T>, input: unknown): T {
  const result = schemaOf.safeParse(input);
  if (!result.success) throw new NewsError('INVALID', result.error.issues[0]?.message ?? 'invalid');
  return result.data;
}

/** Run `fn` in the context workspace after checking that `userId` is an active member of it. */
async function asMember<T>(
  ctx: NewsContext,
  userId: string,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  if (!uuid.safeParse(ctx.workspaceId).success) throw new NewsError('INVALID', 'invalid workspace');
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId }, async (tx) => {
    const [row] = await tx
      .select({ id: member.id })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(
        and(
          eq(member.organizationId, ctx.workspaceId),
          eq(member.userId, userId),
          eq(member.status, 'active'),
          isNull(organization.deletedAt),
        ),
      );
    if (!row) throw new NewsError('FORBIDDEN', 'not a member of this workspace');
    return fn(tx);
  });
}

const toPreference = (row: typeof newsPref.$inferSelect): NewsPreference => ({
  practiceAreas: row.practiceAreas as NewsPracticeArea[],
  forums: row.forums as NewsForum[],
  digestTime: row.digestTime,
  lastDigestDate: row.lastDigestDate,
});

/** The member's news preferences, or `null` when they have not set any (no digest then). */
export async function getNewsPref(
  ctx: NewsContext,
  input: { userId: string },
): Promise<NewsPreference | null> {
  const { userId } = parse(z.strictObject({ userId: uuid }), input);
  return asMember(ctx, userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(newsPref)
      .where(and(eq(newsPref.workspaceId, ctx.workspaceId), eq(newsPref.userId, userId)));
    return row === undefined ? null : toPreference(row);
  });
}

/** Save the member's followed practice areas and forums and their digest time. */
export async function setNewsPref(
  ctx: NewsContext,
  input: { userId: string; practiceAreas: string[]; forums: string[]; digestTime: string },
): Promise<NewsPreference> {
  const pref = parse(prefInput, input);
  return asMember(ctx, pref.userId, async (tx) => {
    const values = {
      practiceAreas: [...new Set(pref.practiceAreas)],
      forums: [...new Set(pref.forums)],
      digestTime: pref.digestTime,
    };
    const [row] = await tx
      .insert(newsPref)
      .values({ workspaceId: ctx.workspaceId, userId: pref.userId, ...values })
      .onConflictDoUpdate({
        target: [newsPref.workspaceId, newsPref.userId],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    if (row === undefined) throw new NewsError('INVALID', 'preference not saved');
    return toPreference(row);
  });
}

/** Record that the digest of `localDate` went out: at most one a day. */
export async function markNewsDigestSent(
  ctx: NewsContext,
  input: { userId: string; localDate: string },
): Promise<void> {
  const { userId, localDate } = parse(
    z.strictObject({ userId: uuid, localDate: z.iso.date() }),
    input,
  );
  await asMember(ctx, userId, async (tx) => {
    await tx
      .update(newsPref)
      .set({ lastDigestDate: localDate })
      .where(and(eq(newsPref.workspaceId, ctx.workspaceId), eq(newsPref.userId, userId)));
  });
}

/** Active members whose digest time is `slot` and who have not had the digest of `localDate`. */
export async function listNewsDigestRecipients(
  ctx: NewsContext,
  input: { slot: string; localDate: string },
): Promise<string[]> {
  if (!uuid.safeParse(ctx.workspaceId).success) throw new NewsError('INVALID', 'invalid workspace');
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, async (tx) => {
    const rows = await tx
      .select({ userId: newsPref.userId, last: newsPref.lastDigestDate })
      .from(newsPref)
      .innerJoin(
        member,
        and(eq(member.organizationId, newsPref.workspaceId), eq(member.userId, newsPref.userId)),
      )
      .where(
        and(
          eq(newsPref.workspaceId, ctx.workspaceId),
          eq(newsPref.digestTime, input.slot),
          eq(member.status, 'active'),
        ),
      );
    return rows.filter((r) => r.last !== input.localDate).map((r) => r.userId);
  });
}

/** One item as shown to a member: the link to the original and who published it. */
export interface NewsEntry {
  id: string;
  sourceId: string;
  /** Attribution: the publisher of the feed (`source.owner`). */
  sourceName: string;
  title: string;
  /** The original article. */
  url: string;
  publishedAt: Date;
  excerpt: string | null;
  tags: NewsTags;
  /** Tagged to a practice area or forum the member follows. */
  matched: boolean;
}

/** How many of the member's followed areas and forums the item is tagged with. */
export function newsMatchScore(
  tags: NewsTags,
  pref: Pick<NewsPreference, 'practiceAreas' | 'forums'> | null,
): number {
  if (pref === null) return 0;
  return (
    tags.practiceAreas.filter((a) => pref.practiceAreas.includes(a)).length +
    tags.forums.filter((f) => pref.forums.includes(f)).length
  );
}

/** Items tagged to the member's areas and forums first (best match first), then newest first. */
export function rankNewsItems<T extends { tags: NewsTags; publishedAt: Date }>(
  items: readonly T[],
  pref: Pick<NewsPreference, 'practiceAreas' | 'forums'> | null,
): T[] {
  return items
    .map((item) => ({ item, score: newsMatchScore(item.tags, pref) }))
    .sort(
      (a, b) =>
        b.score - a.score || b.item.publishedAt.getTime() - a.item.publishedAt.getTime(),
    )
    .map(({ item }) => item);
}

async function recentItems(
  db: Queryable,
  since: Date,
  limit: number,
): Promise<Omit<NewsEntry, 'matched'>[]> {
  const rows = await db
    .select({
      id: newsItem.id,
      sourceId: newsItem.sourceId,
      sourceName: source.owner,
      title: newsItem.title,
      url: newsItem.url,
      publishedAt: newsItem.publishedAt,
      excerpt: newsItem.excerpt,
      tags: newsItem.tags,
    })
    .from(newsItem)
    .innerJoin(source, eq(source.id, newsItem.sourceId))
    .where(gte(newsItem.publishedAt, since))
    .orderBy(desc(newsItem.publishedAt))
    .limit(limit);
  return rows;
}

async function rankedFor(
  ctx: NewsContext,
  userId: string,
  since: Date,
  limit: number,
  pool: number,
): Promise<NewsEntry[]> {
  return asMember(ctx, userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(newsPref)
      .where(and(eq(newsPref.workspaceId, ctx.workspaceId), eq(newsPref.userId, userId)));
    const pref = row === undefined ? null : toPreference(row);
    const items = await recentItems(tx, since, pool);
    return rankNewsItems(items, pref)
      .slice(0, limit)
      .map((item) => ({ ...item, matched: newsMatchScore(item.tags, pref) > 0 }));
  });
}

/** The News page: the last `days` of items, the member's tagged items first, then by recency. */
export async function listNewsForMember(
  ctx: NewsContext,
  input: { userId: string; since: Date; limit?: number },
): Promise<NewsEntry[]> {
  const { userId } = parse(z.strictObject({ userId: uuid }), { userId: input.userId });
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  return rankedFor(ctx, userId, input.since, limit, 400);
}

/**
 * The items of a member's digest: published since `since` (the last digest), the member's tagged
 * items first. An empty list means nothing is sent.
 */
export async function selectNewsDigestItems(
  ctx: NewsContext,
  input: { userId: string; since: Date },
): Promise<NewsEntry[]> {
  const { userId } = parse(z.strictObject({ userId: uuid }), { userId: input.userId });
  return rankedFor(ctx, userId, input.since, NEWS_DIGEST_MAX_ITEMS, 400);
}

/** Cleared, not killed `news` and `licensed` sources: the poll job fans out over these. */
export async function listNewsSourceIds(db: Queryable = appDb): Promise<string[]> {
  const rows = await db
    .select({ id: source.id })
    .from(source)
    .where(
      and(
        eq(source.killSwitch, false),
        isNotNull(source.clearedAt),
        inArray(source.kind, ['news', 'licensed']),
      ),
    )
    .orderBy(asc(source.id));
  return rows.map((r) => r.id);
}
