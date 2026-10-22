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
// Each event also stores `actor_ref`, a salted sha256 of `actor_user_id` (per-user salt in the
// owner-only `audit_actor_salt`, migration 0031). The hash covers `actor_ref` instead of the id, so
// account deletion (#303) can null `actor_user_id` through `app_audit_anonymise_actor()` without
// breaking the chain; deleting the salt then makes the ref unlinkable. See docs/engineering/audit.md.
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
  uniqueIndex,
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
    /** Salted sha256 (hex) of `actor_user_id`; the chain hash covers this, not the id. */
    actorRef: text('actor_ref'),
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
    // Account deletion (#303) finds a user's events across every chain.
    index('audit_event_actor_user_id_idx')
      .on(t.actorUserId)
      .where(sql`actor_user_id is not null`),
    // One genesis and one successor per hash in each chain: a fork cannot be stored.
    unique('audit_event_chain_uq').on(t.workspaceId, t.prevHash).nullsNotDistinct(),
  ],
);

/**
 * Per-user salt for `audit_event.actor_ref` (#303). Global and owner-only: the app role has no
 * privileges; only the SECURITY DEFINER audit functions read or write it. Account deletion deletes
 * the row, so a deleted user's `actor_ref` cannot be recomputed from their id.
 */
export const auditActorSalt = pgTable('audit_actor_salt', {
  userId: uuid('user_id').primaryKey(),
  salt: bytea('salt').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    // Gateway columns (#44, migration 0053). The row stores hashes and ids only, never content.
    /** The gateway task id, e.g. `classify_document`; null on rows written before the gateway. */
    task: text('task'),
    latencyMs: integer('latency_ms'),
    /** `ok`, `error`, `blocked_sensitive`, `residency_violation`, `budget_exceeded` or `output_invalid`. */
    status: text('status').notNull().default('ok'),
    errorCode: text('error_code'),
    /** sha256 hex of the normalised input; the input itself is never stored. */
    inputSha256: text('input_sha256'),
    captureId: uuid('capture_id'),
    matterId: uuid('matter_id'),
    /** The policy flagged instruction-like content in the input. */
    suspicious: boolean('suspicious').notNull().default(false),
    /** Job id + task; a retry with the same key reuses the stored result (`ai_call_result`). */
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_call_capture_idx').on(t.workspaceId, t.captureId),
    uniqueIndex('ai_call_idempotency_uq')
      .on(t.workspaceId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check('ai_call_automation_level_chk', sql`automation_level between 1 and 4`),
    check('ai_call_usage_chk', sql`input_tokens >= 0 and output_tokens >= 0 and cost_paise >= 0`),
  ],
);

/**
 * The validated output of an idempotent gateway call (#44), so a job retry reuses it instead of
 * paying twice. `ai_call` is append-only and holds no content, so the output lives here and
 * expires after 24 hours; rows past `expires_at` are never read and are deleted on the next write.
 */
export const aiCallResult = tenantTable(
  'ai_call_result',
  {
    id: idV7(),
    idempotencyKey: text('idempotency_key').notNull(),
    aiCallId: uuid('ai_call_id').notNull(),
    output: jsonb('output').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_call_result_key_uq').on(t.workspaceId, t.idempotencyKey)],
);
