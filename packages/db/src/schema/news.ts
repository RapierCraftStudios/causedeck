// The legal news digest tables (#481, D-048). `news_item` is global (GLOBAL_TABLES, no workspace,
// no RLS): one row per article the feed of a registered `news`/`licensed` source announced. It
// holds only what the feed itself provides (headline, link, date, the feed's own excerpt) and a
// provenance stamp; there is deliberately no body column, so full article text cannot be stored
// (copyright: headlines and links unless the source is licensed). `news_pref` is a tenant table:
// one row per member with the practice areas and forums they follow and their digest time.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

/** Longest feed excerpt stored, in characters. */
export const NEWS_EXCERPT_MAX = 500;

/** The practice areas an item or a member can be tagged with (closed list: no free text). */
export const NEWS_PRACTICE_AREAS = [
  'civil',
  'criminal',
  'constitutional',
  'corporate',
  'tax',
  'ibc',
  'arbitration',
  'family',
  'labour',
  'property',
  'ip',
  'consumer',
  'environment',
  'banking',
  'service',
] as const;
export type NewsPracticeArea = (typeof NEWS_PRACTICE_AREAS)[number];

/** The forums an item or a member can be tagged with (closed list: no free text). */
export const NEWS_FORUMS = [
  'supreme_court',
  'high_court',
  'district_court',
  'nclt',
  'nclat',
  'itat',
  'drt',
  'consumer_forum',
  'tribunal',
  'regulator',
] as const;
export type NewsForum = (typeof NEWS_FORUMS)[number];

export interface NewsTags {
  practiceAreas: NewsPracticeArea[];
  forums: NewsForum[];
}

export const newsItem = pgTable(
  'news_item',
  {
    id: id(),
    /** The `source.id` of the feed's registry row. */
    sourceId: text('source_id').notNull(),
    title: text('title').notNull(),
    /** The original article: every item links to it. */
    url: text('url').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    /** The feed's own excerpt, plain text, capped at NEWS_EXCERPT_MAX; never scraped article text. */
    excerpt: text('excerpt'),
    tags: jsonb('tags').$type<NewsTags>().notNull().default({ practiceAreas: [], forums: [] }),
    /** sha256 hex of the feed document the item came from. */
    provenanceSha256: text('provenance_sha256').notNull(),
    provenanceFetchedAt: timestamp('provenance_fetched_at', { withTimezone: true }).notNull(),
    /** `source.updated_at` (ISO) of the registry row that cleared the fetch. */
    provenanceSourceVersion: text('provenance_source_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('news_item_source_url_uq').on(t.sourceId, t.url),
    index('news_item_published_idx').on(t.publishedAt),
    check('news_item_excerpt_chk', sql`${t.excerpt} is null or char_length(${t.excerpt}) <= 500`),
  ],
);

export const newsPref = tenantTable(
  'news_pref',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    practiceAreas: text('practice_areas')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    forums: text('forums')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The local `HH:MM` (:00 or :30) the daily digest goes out. */
    digestTime: text('digest_time').notNull().default('07:30'),
    /** The local day of the last digest sent: at most one a day. */
    lastDigestDate: text('last_digest_date'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'news_pref_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    primaryKey({ name: 'news_pref_pkey', columns: [t.workspaceId, t.userId] }),
  ],
);
