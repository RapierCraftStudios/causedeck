// The source registry (#478, D-048): one global table that decides whether, how and how often
// CauseDeck may read any external source (a court page, a notices page, a news feed, a licensed
// API or a corpus). It generalises `access_mode_registry` (D-028, #22), which stays the
// per-resource enforcement table for court adapters; migration 0065 backfills one uncleared
// `source` row per adapter. `source` is a global table (GLOBAL_TABLES): no workspace, no RLS, and
// staff write it through the app role (SELECT, INSERT, UPDATE; never DELETE).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps } from '../columns.ts';

import { user } from './auth.ts';

export const SOURCE_KINDS = ['court', 'notice', 'news', 'licensed', 'corpus'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const sourceKind = pgEnum('source_kind', SOURCE_KINDS);

/** Adapter access levels A0-A3, as on `forum.adapter_level`. */
export const SOURCE_ACCESS_MODES = ['A0', 'A1', 'A2', 'A3'] as const;
export type SourceAccessMode = (typeof SOURCE_ACCESS_MODES)[number];
export const sourceAccessMode = pgEnum('source_access_mode', SOURCE_ACCESS_MODES);

/** Terms and counsel review state; a source is cleared only when both are `cleared`. */
export const SOURCE_REVIEW_STATUSES = ['pending', 'cleared', 'rejected'] as const;
export type SourceReviewStatus = (typeof SOURCE_REVIEW_STATUSES)[number];
export const sourceReviewStatus = pgEnum('source_review_status', SOURCE_REVIEW_STATUSES);

/** AlterLab fetch tiers in ascending cost; `captcha` solves challenges and is never allowed for court or notice sources. */
export const SOURCE_MAX_TIERS = ['http', 'headless', 'proxy', 'captcha'] as const;
export type SourceMaxTier = (typeof SOURCE_MAX_TIERS)[number];
export const sourceMaxTier = pgEnum('source_max_tier', SOURCE_MAX_TIERS);

/** What a source's records hold: party names and the like (`personal`), none (`non-personal`) or both (`mixed`). */
export const SOURCE_DATA_CLASSES = ['personal', 'non-personal', 'mixed'] as const;
export type SourceDataClass = (typeof SOURCE_DATA_CLASSES)[number];

/** Kinds that are courts or government pages: they may never be fetched through a captcha tier. */
export const NO_CAPTCHA_KINDS = ['court', 'notice'] as const satisfies readonly SourceKind[];

export const source = pgTable(
  'source',
  {
    /** Stable slug, e.g. the court adapter id `in.nclt.bengaluru`. */
    id: text('id').primaryKey(),
    kind: sourceKind('kind').notNull(),
    baseUrl: text('base_url').notNull(),
    owner: text('owner').notNull(),
    accessMode: sourceAccessMode('access_mode').notNull().default('A0'),
    termsStatus: sourceReviewStatus('terms_status').notNull().default('pending'),
    counselStatus: sourceReviewStatus('counsel_status').notNull().default('pending'),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(1),
    retentionDays: integer('retention_days').notNull().default(30),
    residency: text('residency').notNull().default('in'),
    /** DPDP data class (D-048); an untagged source is `personal`, so it is never exposed through the API. */
    dataClass: text('data_class').$type<SourceDataClass>().notNull().default('personal'),
    maxTier: sourceMaxTier('max_tier').notNull().default('http'),
    maxCostDollars: numeric('max_cost_dollars', { precision: 10, scale: 4 }).notNull().default('0'),
    /** Counsel has cleared bulk captcha solving for this source (D-048); the raised tier is computed in code, never stored. */
    captchaBulkCleared: boolean('captcha_bulk_cleared').notNull().default(false),
    killSwitch: boolean('kill_switch').notNull().default(false),
    notes: text('notes'),
    updatedBy: uuid('updated_by').references(() => user.id),
    ...timestamps(),
  },
  (t) => [
    check(
      'source_no_captcha_chk',
      sql`not (${t.kind} in ('court', 'notice') and ${t.maxTier} = 'captcha')`,
    ),
    check('source_rate_limit_chk', sql`${t.rateLimitPerMinute} > 0`),
    check('source_data_class_chk', sql`${t.dataClass} in ('personal', 'non-personal', 'mixed')`),
    check('source_retention_chk', sql`${t.retentionDays} >= 0`),
    check('source_max_cost_chk', sql`${t.maxCostDollars} >= 0`),
    check(
      'source_cleared_chk',
      sql`${t.clearedAt} is null or (${t.termsStatus} = 'cleared' and ${t.counselStatus} = 'cleared')`,
    ),
  ],
);
