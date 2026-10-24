// The automation engine tables (#47, ADR 0023; docs/product/09 §4): `proposal` (a change that
// waits for a person, or the record of one that was applied), `activity` (what the system or a
// person did, with its 7-day undo), `automation_preference` (the per-user "ask me first" dial) and
// `automation_threshold` (the auto-apply confidence per kind and pattern, raised on every undo).
// Tenant tables under FORCE RLS via `tenantTable()`.
//
// The ladder is `L1..L4` and nothing else: `proposal_level_chk` and `activity_level_chk` reject any
// other value, so a fifth level cannot be stored (PRD TR-1; `scripts/check-no-l5.ts` guards the
// code). `capture_id`, `matter_id`, `proceeding_id` and `ai_call_id` are plain uuids without
// foreign keys: the capture table arrives with #43, and an erase or an `ai_call` retention purge
// must not be blocked by, or null, the history of what the engine did.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';

export const AUTOMATION_LEVELS = ['L1', 'L2', 'L3', 'L4'] as const;
export type AutomationLevelValue = (typeof AUTOMATION_LEVELS)[number];

export const PROPOSAL_STATUSES = [
  'proposed',
  'accepted',
  'edited',
  'dismissed',
  'expired',
  'superseded',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const ACTIVITY_ACTORS = ['system', 'user'] as const;
export type ActivityActor = (typeof ACTIVITY_ACTORS)[number];

export const proposal = tenantTable(
  'proposal',
  {
    id: id(),
    captureId: uuid('capture_id'),
    kind: text('kind').notNull(),
    level: text('level').$type<AutomationLevelValue>().notNull(),
    status: text('status').$type<ProposalStatus>().notNull().default('proposed'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    anchors: jsonb('anchors')
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    matterId: uuid('matter_id'),
    proceedingId: uuid('proceeding_id'),
    /** sha256 of kind + payload + capture: a dismissed or applied draft is never proposed twice. */
    idempotencyKey: text('idempotency_key').notNull(),
    /** A card the person must look at: an invalid, unanchored, low-confidence or ambiguous draft. */
    needsYou: boolean('needs_you').notNull().default(false),
    needsYouReason: text('needs_you_reason'),
    /** The graph record a handler staged at submit time (e.g. the proposed next-date listing). */
    entityRefs: jsonb('entity_refs')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The draft's source, pattern key, match, duplicate and ambiguity: what a later accept needs. */
    meta: jsonb('meta')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    resolvedBy: uuid('resolved_by').references(() => user.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionReason: text('resolution_reason'),
    editDiff: jsonb('edit_diff').$type<Record<string, unknown>>(),
    aiCallId: uuid('ai_call_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('proposal_workspace_id_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('proposal_workspace_idempotency_uq').on(t.workspaceId, t.idempotencyKey),
    index('proposal_workspace_status_idx').on(t.workspaceId, t.status, t.createdAt),
    index('proposal_workspace_capture_idx').on(t.workspaceId, t.captureId),
    foreignKey({
      name: 'proposal_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('proposal_level_chk', sql`level in ${inList(AUTOMATION_LEVELS)}`),
    check('proposal_status_chk', sql`status in ${inList(PROPOSAL_STATUSES)}`),
    check(
      'proposal_confidence_chk',
      sql`confidence is null or (confidence >= 0 and confidence <= 1)`,
    ),
    check(
      'proposal_resolved_chk',
      sql`status in ('proposed', 'superseded') or resolved_at is not null`,
    ),
  ],
);

export const activity = tenantTable(
  'activity',
  {
    id: id(),
    captureId: uuid('capture_id'),
    proposalId: uuid('proposal_id'),
    kind: text('kind').notNull(),
    level: text('level').$type<AutomationLevelValue>().notNull(),
    actor: text('actor').$type<ActivityActor>().notNull(),
    actorUserId: uuid('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    summary: text('summary').notNull(),
    /** The graph records the action touched, by table: `{ matterId, documentIds: [...] }`. */
    entityRefs: jsonb('entity_refs')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    undoPayload: jsonb('undo_payload').$type<Record<string, unknown>>(),
    /** `created_at + 7 days`; an undo after it throws `UndoExpiredError`. */
    undoExpiresAt: timestamp('undo_expires_at', { withTimezone: true }).notNull(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoneBy: uuid('undone_by').references(() => user.id, { onDelete: 'set null' }),
    parentActivityId: uuid('parent_activity_id'),
    cascadeGroupId: uuid('cascade_group_id'),
    /** A person confirmed or edited the result after the system applied it: it can no longer be undone. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => user.id, { onDelete: 'set null' }),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    /** Input source, plus model, version and region copied from the linked `ai_call` (never content). */
    source: jsonb('source')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('activity_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('activity_workspace_created_idx').on(t.workspaceId, t.createdAt),
    index('activity_workspace_capture_idx').on(t.workspaceId, t.captureId),
    index('activity_workspace_cascade_idx').on(t.workspaceId, t.cascadeGroupId),
    foreignKey({
      name: 'activity_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'activity_proposal_fk',
      columns: [t.workspaceId, t.proposalId],
      foreignColumns: [proposal.workspaceId, proposal.id],
    }),
    foreignKey({
      name: 'activity_parent_fk',
      columns: [t.workspaceId, t.parentActivityId],
      foreignColumns: [t.workspaceId, t.id],
    }).onDelete('cascade'),
    check('activity_level_chk', sql`level in ${inList(AUTOMATION_LEVELS)}`),
    check('activity_actor_chk', sql`actor in ${inList(ACTIVITY_ACTORS)}`),
    check('activity_summary_chk', sql`btrim(summary) <> ''`),
    check(
      'activity_confidence_chk',
      sql`confidence is null or (confidence >= 0 and confidence <= 1)`,
    ),
    check('activity_undo_window_chk', sql`undo_expires_at >= created_at`),
  ],
);

export const automationPreference = tenantTable(
  'automation_preference',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** True: this user's L3 actions of `kind` are proposals (L2) instead. */
    askFirst: boolean('ask_first').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('automation_preference_user_kind_uq').on(t.workspaceId, t.userId, t.kind),
    foreignKey({
      name: 'automation_preference_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
  ],
);

export const automationThreshold = tenantTable(
  'automation_threshold',
  {
    id: id(),
    kind: text('kind').notNull(),
    patternKey: text('pattern_key').notNull(),
    /** The least confidence at which a draft of this kind and pattern is applied without asking. */
    threshold: numeric('threshold', { precision: 4, scale: 3 }).notNull(),
    undoCount: integer('undo_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('automation_threshold_kind_pattern_uq').on(t.workspaceId, t.kind, t.patternKey),
    foreignKey({
      name: 'automation_threshold_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('automation_threshold_range_chk', sql`threshold >= 0 and threshold <= 0.99`),
  ],
);
