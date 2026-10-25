// Drafting data layer (#766, part 1 of #75). `template` is a global-or-workspace table
// (`globalOrWorkspaceTable()`): a null `workspace_id` is a system template every workspace may read
// but only the owner (migration) role writes; a workspace id is that workspace's own template.
// `draft` is a workspace document built from a template, and `draft_version` is one immutable
// snapshot of its content with a `content_sha256` (a trigger rejects any change after insert, so an
// exported version can always be reproduced). The block tree in `template.blocks` and
// `draft_version.content` is validated by `@causedeck/validators/drafting`; the db stores jsonb.
// A draft's single-column FK to `template` is guarded by `app_reference_scope_guard`.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { globalOrWorkspaceTable } from '../schema-helpers/global-or-workspace-table.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';
import { matter } from './matter-graph.ts';

export const DRAFT_STATUSES = ['draft', 'final'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** A recursive block tree as stored; the shape is enforced by the validators package. */
export type DraftingBlocks = unknown[];

export const template = globalOrWorkspaceTable(
  'template',
  {
    id: id(),
    /** Stable slug, unique per scope, e.g. `in.notice.legal`. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    /** Court format preset key (validators `COURT_PRESETS`). */
    courtPreset: text('court_preset').notNull(),
    blocks: jsonb('blocks')
      .$type<DraftingBlocks>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    locale: text('locale').notNull().default('en'),
    version: integer('version').notNull().default(1),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique('template_scope_code_uq').on(t.workspaceId, t.code).nullsNotDistinct(),
    check('template_version_chk', sql`version >= 1`),
  ],
);

export const draft = tenantTable(
  'draft',
  {
    id: id(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => template.id, { onDelete: 'restrict' }),
    matterId: uuid('matter_id'),
    title: text('title').notNull(),
    status: text('status').notNull().default('draft'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'draft_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    unique('draft_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'draft_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    check('draft_status_chk', sql`status in ${inList(DRAFT_STATUSES)}`),
  ],
);

export const draftVersion = tenantTable(
  'draft_version',
  {
    id: id(),
    draftId: uuid('draft_id').notNull(),
    versionNo: integer('version_no').notNull(),
    content: jsonb('content').$type<DraftingBlocks>().notNull(),
    /** sha256 hex of the canonical content, so a version is verifiable and reproducible. */
    contentSha256: text('content_sha256').notNull(),
    /** Only ever updated to null, when the author is erased (see the immutability trigger). */
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'draft_version_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'draft_version_draft_fk',
      columns: [t.workspaceId, t.draftId],
      foreignColumns: [draft.workspaceId, draft.id],
    }).onDelete('cascade'),
    unique('draft_version_draft_no_uq').on(t.draftId, t.versionNo),
    unique('draft_version_workspace_id_id_uq').on(t.workspaceId, t.id),
    check('draft_version_no_chk', sql`version_no >= 1`),
    check('draft_version_sha256_chk', sql`content_sha256 ~ '^[0-9a-f]{64}$'`),
  ],
);

export const DRAFT_EXPORT_FORMATS = ['docx', 'pdf'] as const;
export type DraftExportFormat = (typeof DRAFT_EXPORT_FORMATS)[number];

/**
 * One stored export of a draft version (#768). `draft_version` is immutable, so the export record
 * lives here: unique per `(draft_version_id, format)`, which makes the `drafting.export` job
 * idempotent. `storage_key` is an encrypted object under the workspace's `ws/<id>/export/` prefix.
 */
export const draftExport = tenantTable(
  'draft_export',
  {
    id: id(),
    draftVersionId: uuid('draft_version_id').notNull(),
    format: text('format').notNull(),
    storageKey: text('storage_key').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** sha256 hex of the version content this file was rendered from (also in the audit event). */
    contentSha256: text('content_sha256').notNull(),
    exportedAt: timestamp('exported_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    foreignKey({
      name: 'draft_export_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'draft_export_version_fk',
      columns: [t.workspaceId, t.draftVersionId],
      foreignColumns: [draftVersion.workspaceId, draftVersion.id],
    }).onDelete('cascade'),
    unique('draft_export_version_format_uq').on(t.draftVersionId, t.format),
    check('draft_export_format_chk', sql`format in ${inList(DRAFT_EXPORT_FORMATS)}`),
    check('draft_export_size_chk', sql`size_bytes >= 0`),
  ],
);
