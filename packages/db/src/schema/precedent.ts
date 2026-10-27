// M5 precedent bank (#901, ADR 0046). One `precedent_passage` per passage a lawyer confirmed from
// one of their own exported drafts: it is the typed side of an M5 `memory_item` (same owner, same
// chamber-sharing switch), pinned to the immutable `draft_version` and block it came from. The body
// is envelope-encrypted (`encryptField`, AAD = workspace id); similarity search runs on the
// `memory_embedding` row of the item, so no plaintext is needed in SQL.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization } from './auth.ts';
import { draftVersion } from './drafting.ts';
import { memoryItem } from './memory.ts';

export const PRECEDENT_PASSAGE_KINDS = [
  'prayer',
  'ground',
  'facts',
  'averment',
  'argument',
  'annexure_list',
  'other',
] as const;
export const PRECEDENT_PASSAGE_STATUSES = ['active', 'retired', 'deleted'] as const;
export type PrecedentPassageStatus = (typeof PRECEDENT_PASSAGE_STATUSES)[number];

export const precedentPassage = tenantTable(
  'precedent_passage',
  {
    id: id(),
    memoryItemId: uuid('memory_item_id').notNull(),
    courtId: uuid('court_id'),
    kind: text('kind').notNull(),
    language: text('language').notNull().default('en'),
    /** Envelope-encrypted passage text; null once deleted. */
    bodyCiphertext: text('body_ciphertext'),
    sourceDraftVersionId: uuid('source_draft_version_id').notNull(),
    anchorId: text('anchor_id').notNull(),
    status: text('status').$type<PrecedentPassageStatus>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'precedent_passage_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'precedent_passage_item_fk',
      columns: [t.workspaceId, t.memoryItemId],
      foreignColumns: [memoryItem.workspaceId, memoryItem.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'precedent_passage_version_fk',
      columns: [t.workspaceId, t.sourceDraftVersionId],
      foreignColumns: [draftVersion.workspaceId, draftVersion.id],
    }).onDelete('restrict'),
    unique('precedent_passage_item_uq').on(t.workspaceId, t.memoryItemId),
    index('precedent_passage_court_idx').on(t.workspaceId, t.courtId, t.status),
    check('precedent_passage_kind_chk', sql`kind in ${inList(PRECEDENT_PASSAGE_KINDS)}`),
    check('precedent_passage_status_chk', sql`status in ${inList(PRECEDENT_PASSAGE_STATUSES)}`),
    check('precedent_passage_body_chk', sql`(status = 'deleted') = (body_ciphertext is null)`),
  ],
);
