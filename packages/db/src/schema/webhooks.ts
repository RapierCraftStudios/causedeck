// Change webhooks (#626, #487 part 3). `webhook_endpoint` is a workspace's HTTPS receiver with its
// signing secret (shown once at creation; the HMAC needs the plaintext, so it lives in the row under
// FORCE RLS and is never returned by a list) and the event types it wants. `webhook_delivery` is one
// event for one endpoint: a content-free payload (ids and change kinds, D-048) and the retry state.
// Both are tenant tables under FORCE RLS via `tenantTable()`. The sweep job lists due deliveries
// across workspaces only through `app_webhook_delivery_due` (owner-defined).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';

export const WEBHOOK_EVENT_TYPES = ['status.changed', 'order.added', 'causelist.matched'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export const webhookEndpoint = tenantTable(
  'webhook_endpoint',
  {
    id: id(),
    url: text('url').notNull(),
    /** HMAC-SHA256 signing secret (`whsec_...`); returned once, at creation. */
    secret: text('secret').notNull(),
    events: text('events').array().notNull(),
    active: boolean('active').notNull().default(true),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => [
    unique('webhook_endpoint_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'webhook_endpoint_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('webhook_endpoint_url_chk', sql`url ~ '^https://' and length(url) <= 2048`),
    check('webhook_endpoint_events_chk', sql`cardinality(events) > 0`),
    check('webhook_endpoint_failures_chk', sql`consecutive_failures >= 0`),
  ],
);

export const webhookDelivery = tenantTable(
  'webhook_delivery',
  {
    id: id(),
    endpointId: uuid('endpoint_id').notNull(),
    eventType: text('event_type').$type<WebhookEventType>().notNull(),
    /** Idempotency key of the source change (snapshot or publication id plus kind). */
    eventKey: text('event_key').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<WebhookDeliveryStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    /** HTTP status of the last attempt; null when it never got a response. */
    lastStatus: integer('last_status'),
    /** A short error code of the last attempt, never a response body. */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    unique('webhook_delivery_endpoint_event_uq').on(t.workspaceId, t.endpointId, t.eventKey),
    index('webhook_delivery_due_idx').on(t.status, t.nextAttemptAt),
    foreignKey({
      name: 'webhook_delivery_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'webhook_delivery_endpoint_fk',
      columns: [t.workspaceId, t.endpointId],
      foreignColumns: [webhookEndpoint.workspaceId, webhookEndpoint.id],
    }).onDelete('cascade'),
    check('webhook_delivery_type_chk', sql`event_type in ${inList(WEBHOOK_EVENT_TYPES)}`),
    check('webhook_delivery_status_chk', sql`status in ${inList(WEBHOOK_DELIVERY_STATUSES)}`),
    check('webhook_delivery_attempts_chk', sql`attempts >= 0`),
  ],
);
