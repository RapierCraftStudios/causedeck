// Court-adapter versioning and parse health (#372, part 4 of #35; ADR 0015):
// - `adapter_version` is global (GLOBAL_TABLES, no RLS): one row per (adapter, semver) holding the
//   zod-validated config, its sha256 `checksum` and the `fixtures_digest` of the golden fixtures it
//   was verified against. A partial unique index allows exactly one `active` row per adapter; staff
//   manage it through the app role like `access_mode_registry` (0044).
// - `adapter_parse_run` is a tenant table (`tenantTable()`, FORCE RLS): one row per parse with
//   metrics only (counts and hall numbers), never row text, so no party or case detail is stored.
// - `adapter_health_summary` is a view over it grouped by adapter and version only: counts with no
//   workspace or document identifier. It is owned by the owner role and reads every workspace
//   through `owner_definer_read` on `adapter_parse_run` (migration 0044); drizzle only types it.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';
import { document } from './documents.ts';
import { adapterVersionStatus, parseHealthStatus } from './enums.ts';

export const adapterVersion = pgTable(
  'adapter_version',
  {
    id: id(),
    adapterId: text('adapter_id').notNull(),
    version: text('version').notNull(),
    /** An `AdapterConfig` (packages/adapters/src/config/schema.ts), validated before it is stored. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    status: adapterVersionStatus('status').notNull().default('draft'),
    /** sha256 (hex) of the canonical JSON of `config`. */
    checksum: text('checksum').notNull(),
    /** sha256 (hex) of the committed golden fixtures the version last passed. */
    fixturesDigest: text('fixtures_digest'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    activatedBy: uuid('activated_by').references(() => user.id, { onDelete: 'set null' }),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('adapter_version_adapter_version_uq').on(t.adapterId, t.version),
    uniqueIndex('adapter_version_one_active_uq')
      .on(t.adapterId)
      .where(sql`status = 'active'`),
    check('adapter_version_adapter_id_chk', sql`adapter_id ~ '^[a-z][a-z0-9-]*$'`),
    check('adapter_version_semver_chk', sql`version ~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'`),
    check('adapter_version_checksum_chk', sql`checksum ~ '^[0-9a-f]{64}$'`),
    check(
      'adapter_version_fixtures_digest_chk',
      sql`fixtures_digest is null or fixtures_digest ~ '^[0-9a-f]{64}$'`,
    ),
    check('adapter_version_active_chk', sql`status <> 'active' or activated_at is not null`),
  ],
);

export const adapterParseRun = tenantTable(
  'adapter_parse_run',
  {
    id: id(),
    documentId: uuid('document_id').notNull(),
    adapterId: text('adapter_id').notNull(),
    adapterVersion: text('adapter_version').notNull(),
    forumCode: text('forum_code').notNull(),
    /** Candidate rows: emitted rows plus rows dropped for want of an anchor. */
    rowsParsed: integer('rows_parsed').notNull(),
    rowsAnchored: integer('rows_anchored').notNull(),
    unmappedHeadings: integer('unmapped_headings').notNull(),
    unknownCaseTypes: integer('unknown_case_types').notNull(),
    hallsSeen: text('halls_seen')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    hallsUnreadable: text('halls_unreadable')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: parseHealthStatus('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('adapter_parse_run_workspace_forum_idx').on(t.workspaceId, t.forumCode, t.createdAt),
    foreignKey({
      name: 'adapter_parse_run_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'adapter_parse_run_document_fk',
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [document.workspaceId, document.id],
    }).onDelete('cascade'),
    check(
      'adapter_parse_run_counts_chk',
      sql`rows_parsed >= 0 and rows_anchored >= 0 and rows_anchored <= rows_parsed and unmapped_headings >= 0 and unknown_case_types >= 0`,
    ),
  ],
);

/** Created by hand in migration 0044; drizzle-kit does not manage it (`.existing()`). */
export const adapterHealthSummary = pgView('adapter_health_summary', {
  adapterId: text('adapter_id').notNull(),
  adapterVersion: text('adapter_version').notNull(),
  runs: bigint('runs', { mode: 'number' }).notNull(),
  okRuns: bigint('ok_runs', { mode: 'number' }).notNull(),
  degradedRuns: bigint('degraded_runs', { mode: 'number' }).notNull(),
  failedRuns: bigint('failed_runs', { mode: 'number' }).notNull(),
  rowsParsed: bigint('rows_parsed', { mode: 'number' }).notNull(),
  rowsAnchored: bigint('rows_anchored', { mode: 'number' }).notNull(),
}).existing();
