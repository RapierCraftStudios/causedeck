// The capture inbox (#43; PRD CA-1..CA-4, CA-9, CA-10; docs/product/09 §3, §5, §8): every channel
// lands here first as an L1 capture, raw input stored and nothing interpreted. `capture` is one
// row per input; `workspace_capture_channel` records which channels the lawyer switched on and the
// version of the "where your data goes" note they saw. Tenant tables under FORCE RLS via
// `tenantTable()`, composite `(workspace_id, *_id)` FKs.
//
// `raw_storage_key` is the `blob.key` of the raw object (#217) and is nulled once the retention
// job deletes the object; derived data stays. `dedupe_of_capture_id` and `matter_hint_id` are
// `ON DELETE SET NULL (<column>)` in migration 0053 so the workspace_id is never nulled.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';
import { matter } from './matter-graph.ts';

export const CAPTURE_CHANNELS = [
  'share',
  'upload',
  'voice',
  'camera',
  'email',
  'ics',
  'whatsapp_export',
  'bulk_import',
  'manual',
] as const;
export type CaptureChannel = (typeof CAPTURE_CHANNELS)[number];

export const CAPTURE_STATUSES = [
  'received',
  'scanning',
  'queued',
  'processing',
  'needs_you',
  'ready',
  'applied',
  'failed',
  'duplicate',
  'discarded',
  'quarantined',
] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const CAPTURE_SCAN_STATUSES = ['pending', 'clean', 'infected', 'skipped'] as const;
export type CaptureScanStatus = (typeof CAPTURE_SCAN_STATUSES)[number];

export const capture = tenantTable(
  'capture',
  {
    id: id(),
    channel: text('channel').$type<CaptureChannel>().notNull(),
    status: text('status').$type<CaptureStatus>().notNull().default('received'),
    /** The raw object's `blob.key`; null once retention deleted it or for a duplicate. */
    rawStorageKey: text('raw_storage_key'),
    /** Hex sha256 of the raw bytes; set when the upload is completed. */
    sha256: text('sha256'),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** Untrusted display name; never used as a path. */
    originalFilename: text('original_filename'),
    /** Channel details and `history`, the status transitions with timestamps. */
    sourceMeta: jsonb('source_meta')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    dedupeOfCaptureId: uuid('dedupe_of_capture_id'),
    matterHintId: uuid('matter_hint_id'),
    /** CA-10: set from a sensitive matter hint; no AI step ever runs on this capture. */
    aiBlocked: boolean('ai_blocked').notNull().default(false),
    scanStatus: text('scan_status').$type<CaptureScanStatus>().notNull().default('pending'),
    pinned: boolean('pinned').notNull().default(false),
    /** When the raw object may be deleted (audio, forwarded raw text, discarded); null keeps it. */
    ttlAt: timestamp('ttl_at', { withTimezone: true }),
    /** The capturing user; null after the account is deleted (#303). */
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    // The target of the composite `(workspace_id, capture_id)` FKs.
    unique('capture_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('capture_workspace_status_created_idx').on(t.workspaceId, t.status, t.createdAt),
    index('capture_workspace_sha256_idx').on(t.workspaceId, t.sha256),
    foreignKey({
      name: 'capture_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'capture_dedupe_of_fk',
      columns: [t.workspaceId, t.dedupeOfCaptureId],
      foreignColumns: [t.workspaceId, t.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'capture_matter_hint_fk',
      columns: [t.workspaceId, t.matterHintId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('set null'),
    check('capture_channel_chk', sql`channel in ${inList(CAPTURE_CHANNELS)}`),
    check('capture_status_chk', sql`status in ${inList(CAPTURE_STATUSES)}`),
    check('capture_scan_status_chk', sql`scan_status in ${inList(CAPTURE_SCAN_STATUSES)}`),
    check('capture_sha256_chk', sql`sha256 is null or sha256 ~ '^[0-9a-f]{64}$'`),
    check('capture_size_chk', sql`size_bytes >= 0`),
    check(
      'capture_not_duplicate_of_self_chk',
      sql`dedupe_of_capture_id is null or dedupe_of_capture_id <> id`,
    ),
  ],
);

export const workspaceCaptureChannel = tenantTable(
  'workspace_capture_channel',
  {
    channel: text('channel').$type<CaptureChannel>().notNull(),
    enabled: boolean('enabled').notNull().default(false),
    enabledBy: uuid('enabled_by').references(() => user.id, { onDelete: 'set null' }),
    enabledAt: timestamp('enabled_at', { withTimezone: true }),
    /** The version of the "where your data goes" note shown when the channel was enabled. */
    disclosureVersion: text('disclosure_version'),
  },
  (t) => [
    // Table-level so the convention checker sees `workspace_id` leading the primary key.
    primaryKey({ name: 'workspace_capture_channel_pkey', columns: [t.workspaceId, t.channel] }),
    foreignKey({
      name: 'workspace_capture_channel_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('workspace_capture_channel_channel_chk', sql`channel in ${inList(CAPTURE_CHANNELS)}`),
    check(
      'workspace_capture_channel_disclosure_chk',
      sql`not enabled or disclosure_version is not null`,
    ),
  ],
);

export type CaptureRow = typeof capture.$inferSelect;
