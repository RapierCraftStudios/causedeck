// Data lifecycle tables (#301, part 1 of #31; spike §4.2, PRD PL-8, DPDP). See
// docs/engineering/data-lifecycle.md.
//
// - `export_job`: one owner-requested workspace (or own-user) export. `export.build` fills in
//   `steps` checkpoints and `progress`, stores the ZIP as an encrypted `blob` (kind `export`) and
//   sets `expires_at` 24 h after completion; `system.export.expire` deletes it after that. Only the
//   sha256 of a download token is kept (`download_token_hash`), never the token. Tenant table.
// - `deletion_job`: workspace, account and memory deletions (behaviour lands with #302 and #303).
//   `workspace_id` is null only for account deletions, so the table is in NULLABLE_WORKSPACE_TABLES
//   and still under FORCE RLS with `ws_isolation`. Account jobs (`kind = 'account'`, null workspace)
//   are reachable through the `account_self` policy (migration 0031): only with no pinned workspace
//   and only for the session user's own `user_id`.
// - `deletion_tombstone`: the minimal global record that a workspace was erased. It must outlive the
//   purge of every tenant row, so it has no foreign key and is in GLOBAL_TABLES.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { registerTenantTable } from '../rls-policies.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';

export const EXPORT_SCOPES = ['workspace', 'user'] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

export const EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed', 'expired'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const DELETION_KINDS = ['workspace', 'account', 'memory'] as const;
export type DeletionKind = (typeof DELETION_KINDS)[number];

export const DELETION_STATUSES = [
  'pending_cooloff',
  'scheduled',
  'running',
  'erased',
  'cancelled',
  'failed',
] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

export const exportJob = tenantTable(
  'export_job',
  {
    id: id(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scope: text('scope').$type<ExportScope>().notNull(),
    status: text('status').$type<ExportStatus>().notNull().default('queued'),
    progress: smallint('progress').notNull().default(0),
    /** Resumable checkpoints written by `export.build`. */
    steps: jsonb('steps').$type<Record<string, unknown>>().notNull().default({}),
    // No foreign key, like `saas_invoice.pdf_blob_id`: db:check-rls requires FKs to tenant tables
    // to pair `workspace_id`, and `blob` has no unique (id, workspace_id).
    blobId: uuid('blob_id'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /** Hex sha256 of the plaintext ZIP. */
    sha256: text('sha256'),
    /** Hex sha256 of the current download token; the token itself is never stored. */
    downloadTokenHash: text('download_token_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'export_job_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    index('export_job_workspace_created_idx').on(t.workspaceId, t.createdAt),
    index('export_job_ready_expires_idx')
      .on(t.expiresAt)
      .where(sql`status = 'ready'`),
    // One export in flight per requester and workspace (the backstop for `requestExport`).
    uniqueIndex('export_job_active_uq')
      .on(t.workspaceId, t.requestedBy)
      .where(sql`status in ('queued', 'running')`),
    check('export_job_scope_chk', sql`scope in ${inList(EXPORT_SCOPES)}`),
    check('export_job_status_chk', sql`status in ${inList(EXPORT_STATUSES)}`),
    check('export_job_progress_chk', sql`progress between 0 and 100`),
    check(
      'export_job_ready_chk',
      sql`status <> 'ready' or (blob_id is not null and sha256 is not null and expires_at is not null)`,
    ),
  ],
);

registerTenantTable('deletion_job');

export const deletionJob = pgTable(
  'deletion_job',
  {
    id: id(),
    workspaceId: uuid('workspace_id').references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    kind: text('kind').$type<DeletionKind>().notNull(),
    requestedBy: uuid('requested_by').notNull(),
    status: text('status').$type<DeletionStatus>().notNull().default('pending_cooloff'),
    cooloffUntil: timestamp('cooloff_until', { withTimezone: true }),
    eraseAfter: timestamp('erase_after', { withTimezone: true }),
    steps: jsonb('steps').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    receiptHash: text('receipt_hash'),
  },
  (t) => [
    index('deletion_job_workspace_id_idx').on(t.workspaceId, t.createdAt),
    check('deletion_job_kind_chk', sql`kind in ${inList(DELETION_KINDS)}`),
    check('deletion_job_status_chk', sql`status in ${inList(DELETION_STATUSES)}`),
    // Only an account deletion may have no workspace.
    check('deletion_job_workspace_chk', sql`kind = 'account' or workspace_id is not null`),
    check('deletion_job_account_user_chk', sql`kind <> 'account' or user_id is not null`),
  ],
);

export const deletionTombstone = pgTable('deletion_tombstone', {
  workspaceId: uuid('workspace_id').primaryKey(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  receiptHash: text('receipt_hash').notNull(),
});
