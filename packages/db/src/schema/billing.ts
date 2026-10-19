// Billing tables (#28 part 1, #200; spike §4.2). `plan` is global (GLOBAL_TABLES): the catalogue
// rows come from `@causedeck/billing/plans` via the `plans` seeder. `subscription`, `entitlement`,
// `usage_counter` and `billing_event` are tenant tables in the `0004_workspaces` style: NOT NULL
// `workspace_id` referencing the workspace, led index. RLS policies arrive with #19 and the
// cross-tenant registration with #207.
import { GSTIN_PATTERN_SOURCE } from '@causedeck/billing/gstin';
import {
  PLAN_INTERVALS,
  PLAN_KINDS,
  SUBSCRIPTION_STATUSES,
  TERMINAL_SUBSCRIPTION_STATUSES,
} from '@causedeck/billing/plans';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps, workspaceIndex } from '../columns.ts';

import { inList, organization } from './auth.ts';

const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' });

/** The plan catalogue. Prices are integer paise, ex-GST; per seat when `per_seat`. */
export const plan = pgTable(
  'plan',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    interval: text('interval').notNull(),
    pricePaise: integer('price_paise').notNull(),
    perSeat: boolean('per_seat').notNull().default(false),
    clerkSeatPricePaise: integer('clerk_seat_price_paise'),
    minSeats: integer('min_seats').notNull().default(1),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  () => [
    check('plan_kind_chk', sql`kind in ${inList(PLAN_KINDS)}`),
    check('plan_interval_chk', sql`interval in ${inList(PLAN_INTERVALS)}`),
    check(
      'plan_price_chk',
      sql`price_paise >= 0 and (clerk_seat_price_paise is null or clerk_seat_price_paise >= 0)`,
    ),
    check('plan_min_seats_chk', sql`min_seats >= 1`),
  ],
);

/**
 * A workspace's subscription. At most one is not cancelled or expired per workspace. `gstin` is
 * checked for format here; the check digit is verified by `@causedeck/billing/gstin` on capture.
 */
export const subscription = pgTable(
  'subscription',
  {
    id: id(),
    workspaceId: workspaceRef(),
    planId: text('plan_id')
      .notNull()
      .references(() => plan.id),
    status: text('status').notNull(),
    seats: integer('seats').notNull().default(1),
    clerkSeats: integer('clerk_seats').notNull().default(0),
    provider: text('provider').notNull().default('mock'),
    providerSubscriptionId: text('provider_subscription_id'),
    providerCustomerId: text('provider_customer_id'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    graceUntil: timestamp('grace_until', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    gstin: text('gstin'),
    billingEmail: text('billing_email'),
    ...timestamps(),
  },
  (t) => [
    workspaceIndex('subscription', t.workspaceId),
    uniqueIndex('subscription_workspace_current_uq')
      .on(t.workspaceId)
      .where(sql`status not in ${inList(TERMINAL_SUBSCRIPTION_STATUSES)}`),
    uniqueIndex('subscription_provider_subscription_id_uq').on(
      t.provider,
      t.providerSubscriptionId,
    ),
    check('subscription_status_chk', sql`status in ${inList(SUBSCRIPTION_STATUSES)}`),
    check('subscription_seats_chk', sql`seats >= 1 and clerk_seats >= 0`),
    check('subscription_gstin_chk', sql.raw(`gstin is null or gstin ~ '${GSTIN_PATTERN_SOURCE}'`)),
  ],
);

/** Derived entitlements per workspace (#203), keyed like `max_active_matters` or `features.*`. */
export const entitlement = pgTable(
  'entitlement',
  {
    workspaceId: workspaceRef(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    source: text('source').notNull().default('plan'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ name: 'entitlement_pkey', columns: [t.workspaceId, t.key] })],
);

/** Usage counters per workspace, key and period (consumed by #30). */
export const usageCounter = pgTable(
  'usage_counter',
  {
    workspaceId: workspaceRef(),
    key: text('key').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'usage_counter_pkey', columns: [t.workspaceId, t.key, t.periodStart] }),
  ],
);

/**
 * Provider webhook events, one row per provider event id, for idempotent processing (#204).
 * `payload` is the minimised webhook event (`minimiseWebhookEvent`, no contact data) that the
 * `billing.process-event` job applies.
 */
export const billingEvent = pgTable(
  'billing_event',
  {
    providerEventId: text('provider_event_id').primaryKey(),
    workspaceId: workspaceRef(),
    type: text('type').notNull(),
    payloadHash: text('payload_hash').notNull(),
    payload: jsonb('payload'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [workspaceIndex('billing_event', t.workspaceId)],
);
