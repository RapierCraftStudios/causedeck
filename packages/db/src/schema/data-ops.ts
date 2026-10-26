// Data operations alerting (#515, D-049): per-source health and backoff, parse-run yield, the
// alert ledger and the on-call rotation. All four are global (GLOBAL_TABLES, no workspace, no
// RLS) and content-free: ids, versions, counts, timestamps and numbers only, never a fetched body.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth.ts';

export const SOURCE_HEALTH_STATES = ['ok', 'degraded'] as const;
export type SourceHealthState = (typeof SOURCE_HEALTH_STATES)[number];
export const sourceHealthState = pgEnum('source_health_state', SOURCE_HEALTH_STATES);

export const DATA_OPS_ALERT_TYPES = [
  'freshness',
  'error_rate',
  'block_signature',
  'parse_yield',
  'cost_anomaly',
  'conflict_rate',
] as const;
export type DataOpsAlertType = (typeof DATA_OPS_ALERT_TYPES)[number];
export const dataOpsAlertType = pgEnum('data_ops_alert_type', DATA_OPS_ALERT_TYPES);

export const DATA_OPS_ALERT_STATUSES = ['open', 'resolved'] as const;
export type DataOpsAlertStatus = (typeof DATA_OPS_ALERT_STATUSES)[number];
export const dataOpsAlertStatus = pgEnum('data_ops_alert_status', DATA_OPS_ALERT_STATUSES);

/** One row per source the evaluator has acted on: degraded state, backoff and a quarantined parser. */
export const sourceHealth = pgTable(
  'source_health',
  {
    sourceId: text('source_id').primaryKey(),
    state: sourceHealthState('state').notNull().default('ok'),
    /** No fetch before this instant (block-signature backoff). */
    backoffUntil: timestamp('backoff_until', { withTimezone: true }),
    /** Consecutive block backoffs; doubles the next backoff window until a clean run resets it. */
    backoffStep: integer('backoff_step').notNull().default(0),
    /** The parser version routed to the review queue after a yield drop; null when none. */
    quarantinedParserVersion: text('quarantined_parser_version'),
    quarantinedAt: timestamp('quarantined_at', { withTimezone: true }),
    reason: text('reason'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('source_health_backoff_step_chk', sql`${t.backoffStep} >= 0`)],
);

/** One parse run of a source's parser: how many records were expected, parsed and in conflict. */
export const sourceParseRun = pgTable(
  'source_parse_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: text('source_id').notNull(),
    parserVersion: text('parser_version').notNull(),
    expected: integer('expected').notNull(),
    parsed: integer('parsed').notNull(),
    conflicts: integer('conflicts').notNull().default(0),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('source_parse_run_source_ran_idx').on(t.sourceId, t.ranAt),
    check(
      'source_parse_run_counts_chk',
      sql`${t.expected} >= 0 and ${t.parsed} >= 0 and ${t.conflicts} >= 0`,
    ),
  ],
);

/** The alert ledger: one open row per dedup key, resolved in place when the detector recovers. */
export const dataOpsAlert = pgTable(
  'data_ops_alert',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: dataOpsAlertType('type').notNull(),
    sourceId: text('source_id').notNull(),
    /** `<type>:<sourceId>`: at most one open alert per key. */
    dedupKey: text('dedup_key').notNull(),
    status: dataOpsAlertStatus('status').notNull().default('open'),
    /** Numbers only, e.g. `observed 0.4 against floor 0.9`; never fetched content. */
    detail: text('detail').notNull(),
    runbookUrl: text('runbook_url').notNull(),
    /** The on-call staff member at open time, if any rotation row covered it. */
    oncallUserId: uuid('oncall_user_id').references(() => user.id, { onDelete: 'set null' }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** When the open notice went out; set once, so an alert pages once. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolveNotifiedAt: timestamp('resolve_notified_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('data_ops_alert_open_key_uq')
      .on(t.dedupKey)
      .where(sql`${t.status} = 'open'`),
    index('data_ops_alert_source_opened_idx').on(t.sourceId, t.openedAt),
  ],
);

/** The on-call rotation: the staff member covering `[starts_at, ends_at)`. */
export const dataOpsOncall = pgTable(
  'data_ops_oncall',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('data_ops_oncall_window_idx').on(t.startsAt, t.endsAt),
    check('data_ops_oncall_window_chk', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
