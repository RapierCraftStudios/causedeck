// Audit tables (#26 part 1, #226; spike §4.2, §5; PRD TR-3, TR-4). Both are append-only: the app
// role has SELECT and INSERT only, and a trigger rejects UPDATE, DELETE and TRUNCATE for every role
// outside the retention purge functions (`app_purge_audit`, `app_purge_ai_calls`, migration
// 0008_audit). Neither table has foreign keys: audit rows outlive the users and workspaces they
// name (until retention purges them), and an ON DELETE action would be a blocked mutation.
//
// `audit_event` rows are written only through `app_audit_append()`, which chains each workspace's
// events with `hash = sha256(prev_hash || canonical_json(event))` under an advisory lock.
// `workspace_id` is null for account-level events (one chain of their own); see
// NULLABLE_WORKSPACE_TABLES in conventions.ts.
//
// `ai_call` is the AI gateway's record of every model call (#44 writes it; the TypeScript writer
// contract is #227). Columns the gateway fills: `purpose`, `provider`, `model`, `model_version`,
// `region`, token counts, `cost_paise`, `sources` (ids and anchors only, never content),
// `confidence`, `automation_level` (1-4; a CHECK makes an L5 record impossible), `auto_applied`,
// `user_action` and `undone_at`. See docs/engineering/database.md.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { registerTenantTable } from '../rls-policies.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

export const AUDIT_ACTOR_KINDS = ['user', 'staff', 'system', 'api'] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

export const AUDIT_OUTCOMES = ['success', 'denied', 'error'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const auditActorKind = pgEnum('audit_actor_kind', AUDIT_ACTOR_KINDS);
export const auditOutcome = pgEnum('audit_outcome', AUDIT_OUTCOMES);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** `id uuid primary key default app_uuid_v7()` (time-ordered; Postgres 17 has no uuidv7()). */
const idV7 = () =>
  uuid('id')
    .primaryKey()
    .default(sql`app_uuid_v7()`);

registerTenantTable('audit_event');

/** Security and administrative audit events. Insert through `app_audit_append()` only. */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: idV7(),
    workspaceId: uuid('workspace_id'),
    actorUserId: uuid('actor_user_id'),
    actorKind: auditActorKind('actor_kind').notNull(),
    action: text('action').notNull(),
    targetKind: text('target_kind'),
    targetId: text('target_id'),
    outcome: auditOutcome('outcome').notNull().default('success'),
    ip: inet('ip'),
    userAgentHash: text('user_agent_hash'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    prevHash: bytea('prev_hash'),
    hash: bytea('hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_event_workspace_id_idx').on(t.workspaceId, t.createdAt, t.id),
    // One genesis and one successor per hash in each chain: a fork cannot be stored.
    unique('audit_event_chain_uq').on(t.workspaceId, t.prevHash).nullsNotDistinct(),
  ],
);

/** One row per AI model call, written by the AI gateway. */
export const aiCall = tenantTable(
  'ai_call',
  {
    id: idV7(),
    userId: uuid('user_id'),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version'),
    region: text('region').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costPaise: integer('cost_paise').notNull().default(0),
    sources: jsonb('sources').$type<unknown[]>().notNull().default([]),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    automationLevel: smallint('automation_level').notNull(),
    autoApplied: boolean('auto_applied').notNull().default(false),
    userAction: text('user_action'),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('ai_call_automation_level_chk', sql`automation_level between 1 and 4`),
    check('ai_call_usage_chk', sql`input_tokens >= 0 and output_tokens >= 0 and cost_paise >= 0`),
  ],
);
