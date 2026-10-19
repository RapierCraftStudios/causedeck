// Storage tables (#21 part 2, #216; spike §6, architecture §6.3). `workspace_key` holds each
// workspace's data-encryption key (DEK), wrapped by the key-encryption key (KEK) named in `kek_id`
// (AES-256-GCM, AAD = workspace id) by `@causedeck/storage`. Crypto-erase zeroes `wrapped_dek` and
// sets `destroyed_at`; the row stays so a destroyed key is never silently re-created. See
// docs/engineering/storage.md.
//
// `blob` (#217) is the bookkeeping row for one uploaded object: `createUploadIntent` inserts it with
// `scan_status` null (an open intent), and `finalizeUpload` fills in the sniffed MIME and sha256 and
// sets `scan_status = 'pending'` for the ClamAV worker. `enc_header` holds the envelope header once
// blob bodies are encrypted (follow-up); it is null for plaintext objects. `storeSystemBlob` (#255)
// writes server-generated objects (invoice PDFs) encrypted under the workspace DEK, already
// finalized with `scan_status = 'skipped'`, `enc_header` set and `created_by` null (no user).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  foreignKey,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';

/** A Postgres `bytea` column mapped to a Node `Buffer`. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const workspaceKey = tenantTable(
  'workspace_key',
  {
    wrappedDek: bytea('wrapped_dek').notNull(),
    kekId: text('kek_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    destroyedAt: timestamp('destroyed_at', { withTimezone: true }),
  },
  (t) => [
    // Table-level so the convention checker sees `workspace_id` leading the primary key.
    primaryKey({ name: 'workspace_key_pkey', columns: [t.workspaceId] }),
    foreignKey({
      name: 'workspace_key_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    // A destroyed key keeps no key material: every byte of the wrapped DEK is zero.
    check(
      'workspace_key_destroyed_zeroed_chk',
      sql`${t.destroyedAt} is null or ltrim(encode(${t.wrappedDek}, 'hex'), '0') = ''`,
    ),
  ],
);

/** `blob.scan_status` values; null means the upload intent is not finalized yet. */
export const BLOB_SCAN_STATUSES = ['pending', 'clean', 'infected', 'skipped'] as const;

export type BlobScanStatus = (typeof BLOB_SCAN_STATUSES)[number];

export const blob = tenantTable(
  'blob',
  {
    id: id(),
    /** `ws/<workspaceId>/<kind>/<yyyy>/<id>`, built server-side from the row id. */
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    filename: text('filename').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    /** Hex sha256 of the stored bytes; set at finalize. */
    sha256: text('sha256'),
    /** The declared type at intent, replaced by the sniffed type at finalize. */
    mime: text('mime').notNull(),
    encHeader: bytea('enc_header'),
    scanStatus: text('scan_status').$type<BlobScanStatus>(),
    /** The uploading user; null for objects the platform writes itself (#255). */
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'blob_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    uniqueIndex('blob_key_uq').on(t.key),
    check(
      'blob_scan_status_chk',
      sql`${t.scanStatus} is null or ${t.scanStatus} in ${inList(BLOB_SCAN_STATUSES)}`,
    ),
    // Finalized rows carry their hash; open intents have neither.
    check(
      'blob_finalized_chk',
      sql`(${t.finalizedAt} is null) = (${t.scanStatus} is null) and (${t.finalizedAt} is null or ${t.sha256} is not null)`,
    ),
  ],
);
