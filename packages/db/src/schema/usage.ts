// Usage metering tables (#218, #30 part 1; spike §4.2, architecture §6.3), next to `usage_counter`
// in billing.ts. All four are tenant tables built with `tenantTable()`, so they register for row-level
// security and get `ws_isolation` in 0007_usage. They hold keys, numbers and ids only, never customer
// content: `key` and `purpose` must be dotted lowercase identifiers, and `usage_event.metadata` must
// be an object of `*_id` keys with short id-string values (`usage_metadata_ids_only()`, 0007_usage).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

/** A metered key or reservation purpose, e.g. `ai.spend_paise` (no spaces, no prose). */
export const USAGE_KEY_PATTERN_SOURCE = '^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)*$';
export const USAGE_KEY_MAX_LENGTH = 64;

/** `usage_event.metadata`: ids only, keyed like `ai_call_id`. */
export type UsageEventMetadata = Record<`${string}_id`, string>;

const keyCheck = (name: string, column: string) =>
  check(
    name,
    sql.raw(
      `${column} ~ '${USAGE_KEY_PATTERN_SOURCE}' and length(${column}) <= ${String(USAGE_KEY_MAX_LENGTH)}`,
    ),
  );

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Budget held for an in-flight call (#220); released on commit, release or expiry. */
export const usageReservation = tenantTable(
  'usage_reservation',
  {
    id: id(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    purpose: text('purpose').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId], foreignColumns: [organization.id] }).onDelete('cascade'),
    index('usage_reservation_workspace_expires_idx').on(t.workspaceId, t.expiresAt),
    check('usage_reservation_amount_chk', sql`amount_paise >= 0`),
    keyCheck('usage_reservation_purpose_chk', 'purpose'),
  ],
);

/** The usage ledger: one row per metered increment, idempotent per workspace. */
export const usageEvent = tenantTable(
  'usage_event',
  {
    id: id(),
    key: text('key').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    metadata: jsonb('metadata')
      .$type<UsageEventMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId], foreignColumns: [organization.id] }).onDelete('cascade'),
    // Per workspace: a global unique key would reveal another workspace's key through 23505.
    uniqueIndex('usage_event_workspace_idempotency_uq').on(t.workspaceId, t.idempotencyKey),
    keyCheck('usage_event_key_chk', 'key'),
    check('usage_event_metadata_chk', sql`usage_metadata_ids_only(metadata)`),
  ],
);

/** A staff override of a workspace limit; always justified and always expiring. */
export const budgetOverride = tenantTable(
  'budget_override',
  {
    id: id(),
    key: text('key').notNull(),
    limitValue: bigint('limit_value', { mode: 'number' }).notNull(),
    setBy: uuid('set_by')
      .notNull()
      .references(() => user.id),
    reason: text('reason').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId], foreignColumns: [organization.id] }).onDelete('cascade'),
    index('budget_override_workspace_key_idx').on(t.workspaceId, t.key),
    check('budget_override_limit_chk', sql`limit_value >= 0`),
    check('budget_override_reason_chk', sql`length(btrim(reason)) > 0`),
    keyCheck('budget_override_key_chk', 'key'),
  ],
);

/** Closed (or closing) totals per workspace, key and period, written by the rollup (#222). */
export const usagePeriodSummary = tenantTable(
  'usage_period_summary',
  {
    key: text('key').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId], foreignColumns: [organization.id] }).onDelete('cascade'),
    primaryKey({
      name: 'usage_period_summary_pkey',
      columns: [t.workspaceId, t.key, t.periodStart],
    }),
    keyCheck('usage_period_summary_key_chk', 'key'),
  ],
);
