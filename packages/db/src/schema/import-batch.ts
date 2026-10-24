// Bootstrap import (#57 part 1; #546): a batch is one drop of lists, orders and diary photos.
// `import_batch_file` ties each capture of the drop to its adapter and matched-row count, and
// `import_plan` holds the plan the confirm grid edits. Only matched rows are ever stored:
// `unmatched_rows_count` is a counter, and no column holds non-matched row content. The plan is
// purged 30 days after apply (`app_purge_import_plans`, owner-defined as the sweep has no
// workspace); batch and file rows stay for history. Tenant tables under FORCE RLS via
// `tenantTable()`, composite `(workspace_id, …)` FKs keep every row inside its workspace.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';
import { capture } from './capture.ts';

export const IMPORT_BATCH_STATUSES = [
  'pending',
  'processing',
  'ready',
  'applied',
  'undone',
  'failed',
] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const IMPORT_BATCH_FILE_STATUSES = [
  'pending',
  'processing',
  'parsed',
  'unmatched',
  'failed',
] as const;
export type ImportBatchFileStatus = (typeof IMPORT_BATCH_FILE_STATUSES)[number];

export const importBatch = tenantTable(
  'import_batch',
  {
    id: id(),
    /** The importing user; null after the account is deleted (#303). */
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    status: text('status').$type<ImportBatchStatus>().notNull().default('pending'),
    fileCount: integer('file_count').notNull().default(0),
    matchedRows: integer('matched_rows').notNull().default(0),
    /** A counter only: the content of rows that did not match is never stored. */
    unmatchedRowsCount: integer('unmatched_rows_count').notNull().default(0),
    /** Hex sha256 of the plan that was applied; null until then. */
    planHash: text('plan_hash'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // The target of the composite `(workspace_id, batch_id)` FKs.
    unique('import_batch_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('import_batch_workspace_status_idx').on(t.workspaceId, t.status),
    index('import_batch_applied_at_idx')
      .on(t.appliedAt)
      .where(sql`applied_at is not null`),
    foreignKey({
      name: 'import_batch_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('import_batch_status_chk', sql`status in ${inList(IMPORT_BATCH_STATUSES)}`),
    check(
      'import_batch_counts_chk',
      sql`file_count >= 0 and matched_rows >= 0 and unmatched_rows_count >= 0`,
    ),
    check('import_batch_plan_hash_chk', sql`plan_hash is null or plan_hash ~ '^[0-9a-f]{64}$'`),
  ],
);

export const importBatchFile = tenantTable(
  'import_batch_file',
  {
    id: id(),
    batchId: uuid('batch_id').notNull(),
    captureId: uuid('capture_id').notNull(),
    status: text('status').$type<ImportBatchFileStatus>().notNull().default('pending'),
    adapterId: text('adapter_id'),
    rowsMatched: integer('rows_matched').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique('import_batch_file_batch_capture_uq').on(t.batchId, t.captureId),
    index('import_batch_file_workspace_batch_idx').on(t.workspaceId, t.batchId),
    foreignKey({
      name: 'import_batch_file_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'import_batch_file_batch_fk',
      columns: [t.workspaceId, t.batchId],
      foreignColumns: [importBatch.workspaceId, importBatch.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'import_batch_file_capture_fk',
      columns: [t.workspaceId, t.captureId],
      foreignColumns: [capture.workspaceId, capture.id],
    }).onDelete('cascade'),
    check('import_batch_file_status_chk', sql`status in ${inList(IMPORT_BATCH_FILE_STATUSES)}`),
    check('import_batch_file_rows_chk', sql`rows_matched >= 0`),
  ],
);

export const importPlan = tenantTable(
  'import_plan',
  {
    batchId: uuid('batch_id').notNull(),
    /** The `ImportPlan`: matched rows and their clusters only. */
    plan: jsonb('plan').$type<Record<string, unknown>>().notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'import_plan_pk', columns: [t.batchId] }),
    foreignKey({
      name: 'import_plan_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'import_plan_batch_fk',
      columns: [t.workspaceId, t.batchId],
      foreignColumns: [importBatch.workspaceId, importBatch.id],
    }).onDelete('cascade'),
    check('import_plan_object_chk', sql`jsonb_typeof(plan) = 'object'`),
  ],
);
