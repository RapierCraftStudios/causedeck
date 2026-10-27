// Lawyer memory tables (#72; PRD ME-1..ME-4, ADR 0044). `memory_item` is what the OS learned about
// one lawyer: a layer (M1 profile, M2 working preferences, M3 matter memory, M4 private court notes,
// M6 relationship memory, M7 recognition memory), a registered key and an envelope-encrypted value.
// A row exists only after a person confirmed a `memory_proposal` or wrote the note themselves.
// `memory_embedding` holds matter-scoped vectors of items, `memory_usage` each time an item
// influenced an output, and `memory_pause` the per-member "pause all memory" switch. Tenant tables
// under FORCE RLS via `tenantTable()`; the migration adds the scope policies and the clerk view.
//
// A proposal is `observing` while a repeated-edit pattern is still being counted (never shown to
// the lawyer), then `proposed`, then `confirmed` or `dismissed`.
//
// A deleted item keeps its row (status `deleted`, `value_ciphertext` null) so usage history and the
// purge sweep can find its embeddings; the value is gone at once.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';
import { embedding } from '../vector.ts';

import { inList, organization, user } from './auth.ts';
import { matter } from './matter-graph.ts';
import { person } from './people.ts';

export const MEMORY_LAYERS = ['M1', 'M2', 'M3', 'M4', 'M6', 'M7'] as const;
export type MemoryLayerValue = (typeof MEMORY_LAYERS)[number];
export const MEMORY_SCOPE_VALUES = ['user', 'workspace', 'matter'] as const;
export type MemoryScopeValue = (typeof MEMORY_SCOPE_VALUES)[number];
export const MEMORY_ITEM_STATUSES = ['active', 'paused', 'deleted'] as const;
export type MemoryItemStatus = (typeof MEMORY_ITEM_STATUSES)[number];
export const MEMORY_PROPOSAL_STATUS_VALUES = [
  'observing',
  'proposed',
  'confirmed',
  'dismissed',
] as const;
export type MemoryProposalStatusValue = (typeof MEMORY_PROPOSAL_STATUS_VALUES)[number];
export const MEMORY_USAGE_PURPOSES = ['brief', 'draft', 'matching'] as const;
export type MemoryUsagePurpose = (typeof MEMORY_USAGE_PURPOSES)[number];

const ownerRef = (name: string) =>
  uuid(name)
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

export const memoryItem = tenantTable(
  'memory_item',
  {
    id: id(),
    layer: text('layer').$type<MemoryLayerValue>().notNull(),
    key: text('key').notNull(),
    scope: text('scope').$type<MemoryScopeValue>().notNull(),
    matterId: uuid('matter_id'),
    personId: uuid('person_id'),
    /** The member the item belongs to; user-scope items and M4 notes are private to them. */
    ownerUserId: ownerRef('owner_user_id'),
    /** Envelope-encrypted JSON value (`encryptField`, AAD = workspace id); null once deleted. */
    valueCiphertext: text('value_ciphertext'),
    /** `manual`, `edit`, `correction`, `capture` or `ai`. */
    sourceType: text('source_type').notNull(),
    sourceRef: text('source_ref'),
    anchorId: uuid('anchor_id'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    confirmationState: text('confirmation_state').$type<'confirmed' | 'corrected'>().notNull(),
    status: text('status').$type<MemoryItemStatus>().notNull().default('active'),
    /** Denormalised from the key registry: strategy values are hidden from clerks. */
    strategy: boolean('strategy').notNull().default(false),
    /** M4 only, set by an owner: the note is visible to the chamber, not just its author. */
    sharedWithChamber: boolean('shared_with_chamber').notNull().default(false),
    proposalId: uuid('proposal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('memory_item_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'memory_item_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'memory_item_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'memory_item_person_fk',
      columns: [t.workspaceId, t.personId],
      foreignColumns: [person.workspaceId, person.id],
    }).onDelete('cascade'),
    index('memory_item_owner_idx').on(t.workspaceId, t.ownerUserId, t.layer),
    index('memory_item_matter_idx').on(t.workspaceId, t.matterId),
    check('memory_item_layer_chk', sql`layer in ${inList(MEMORY_LAYERS)}`),
    check('memory_item_scope_chk', sql`scope in ${inList(MEMORY_SCOPE_VALUES)}`),
    check('memory_item_status_chk', sql`status in ${inList(MEMORY_ITEM_STATUSES)}`),
    check('memory_item_confirmation_chk', sql`confirmation_state in ('confirmed', 'corrected')`),
    check('memory_item_key_layer_chk', sql`key like layer || '.%'`),
    check('memory_item_matter_scope_chk', sql`(scope = 'matter') = (matter_id is not null)`),
    check('memory_item_layer_scope_chk', sql`(layer = 'M3') = (scope = 'matter')`),
    check('memory_item_person_chk', sql`(layer = 'M6') = (person_id is not null)`),
    check('memory_item_shared_chk', sql`not shared_with_chamber or layer = 'M4'`),
    check(
      'memory_item_value_chk',
      sql`(status = 'deleted') = (value_ciphertext is null) and (status = 'deleted') = (deleted_at is not null)`,
    ),
  ],
);

export const memoryProposal = tenantTable(
  'memory_proposal',
  {
    id: id(),
    layer: text('layer').$type<MemoryLayerValue>().notNull(),
    key: text('key').notNull(),
    scope: text('scope').$type<MemoryScopeValue>().notNull(),
    matterId: uuid('matter_id'),
    personId: uuid('person_id'),
    /** The member the confirmed item will belong to. */
    ownerUserId: ownerRef('owner_user_id'),
    proposedValueCiphertext: text('proposed_value_ciphertext').notNull(),
    /** Why it is proposed: ids and counts, never quoted content. */
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    /** Dedupe key of the pattern behind an edit or correction proposal. */
    patternKey: text('pattern_key'),
    sourceType: text('source_type').notNull(),
    sourceRef: text('source_ref'),
    anchorId: uuid('anchor_id'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    status: text('status').$type<MemoryProposalStatusValue>().notNull().default('proposed'),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'memory_proposal_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'memory_proposal_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    index('memory_proposal_owner_idx').on(t.workspaceId, t.ownerUserId, t.status),
    index('memory_proposal_pattern_idx').on(t.workspaceId, t.ownerUserId, t.patternKey),
    check('memory_proposal_layer_chk', sql`layer in ${inList(MEMORY_LAYERS)}`),
    check('memory_proposal_scope_chk', sql`scope in ${inList(MEMORY_SCOPE_VALUES)}`),
    check('memory_proposal_status_chk', sql`status in ${inList(MEMORY_PROPOSAL_STATUS_VALUES)}`),
    check('memory_proposal_key_layer_chk', sql`key like layer || '.%'`),
    check('memory_proposal_matter_scope_chk', sql`(scope = 'matter') = (matter_id is not null)`),
  ],
);

export const memoryEmbedding = tenantTable(
  'memory_embedding',
  {
    id: id(),
    itemId: uuid('item_id').notNull(),
    /** Set for matter-scoped items so similarity search can be pinned to one matter. */
    matterId: uuid('matter_id'),
    /** What was embedded: the item id and its update time, never the text. */
    contentRef: text('content_ref').notNull(),
    embedding: embedding().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'memory_embedding_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'memory_embedding_item_fk',
      columns: [t.workspaceId, t.itemId],
      foreignColumns: [memoryItem.workspaceId, memoryItem.id],
    }).onDelete('cascade'),
    index('memory_embedding_item_idx').on(t.workspaceId, t.itemId),
    index('memory_embedding_matter_idx').on(t.workspaceId, t.matterId),
    index('memory_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const memoryUsage = tenantTable(
  'memory_usage',
  {
    id: id(),
    itemId: uuid('item_id').notNull(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    usedIn: text('used_in').$type<MemoryUsagePurpose>().notNull(),
    /** The brief, draft or match the item influenced. */
    outputRef: text('output_ref'),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'memory_usage_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'memory_usage_item_fk',
      columns: [t.workspaceId, t.itemId],
      foreignColumns: [memoryItem.workspaceId, memoryItem.id],
    }).onDelete('cascade'),
    index('memory_usage_item_idx').on(t.workspaceId, t.itemId, t.usedAt),
    check('memory_usage_used_in_chk', sql`used_in in ${inList(MEMORY_USAGE_PURPOSES)}`),
  ],
);

/** One row per member who paused all memory: no proposals and no use while it exists. */
export const memoryPause = tenantTable(
  'memory_pause',
  {
    id: id(),
    userId: ownerRef('user_id'),
    pausedAt: timestamp('paused_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'memory_pause_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    unique('memory_pause_workspace_user_uq').on(t.workspaceId, t.userId),
  ],
);
