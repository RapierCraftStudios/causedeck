// Case-status watch (#589, part 1 of #483, D-048): `case_watch` says which proceeding an advocate
// watches at which source and how often; `case_status_snapshot` is one parsed status result of a
// watch, with a content hash (an unchanged page writes no second row) and the provenance of the
// lookup (device or server, tier used, cost). A watch is one advocate's own (`advocate_user_id`, the
// `delegatedFor` of a delegated lookup). Tenant tables under FORCE RLS via `tenantTable()`;
// composite FKs keep both rows inside their workspace and both die with their parent.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, provenance, provenanceCheck, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';
import { CNR_PATTERN, proceeding } from './proceedings.ts';
import { source, sourceMaxTier } from './source-registry.ts';

export const CASE_STATUS_VIA = ['device', 'server'] as const;
export type CaseStatusVia = (typeof CASE_STATUS_VIA)[number];

export const caseWatch = tenantTable(
  'case_watch',
  {
    id: id(),
    proceedingId: uuid('proceeding_id').notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'restrict' }),
    /** The CNR to look up; null when the watch is by case number. */
    cnr: text('cnr'),
    /** The case number as the source's search form takes it; null when the watch is by CNR. */
    caseNumber: text('case_number'),
    /** The advocate the lookups are delegated for (their own matter only). */
    advocateUserId: uuid('advocate_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    cadenceMinutes: integer('cadence_minutes').notNull().default(1440),
    enabled: boolean('enabled').notNull().default(true),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('case_watch_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('case_watch_workspace_proceeding_source_uq').on(
      t.workspaceId,
      t.proceedingId,
      t.sourceId,
    ),
    foreignKey({
      name: 'case_watch_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'case_watch_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }).onDelete('cascade'),
    check('case_watch_cnr_chk', sql`cnr is null or cnr ~ ${sql.raw(`'${CNR_PATTERN}'`)}`),
    check('case_watch_target_chk', sql`cnr is not null or case_number is not null`),
    check('case_watch_cadence_chk', sql`cadence_minutes > 0`),
  ],
);

export const caseStatusSnapshot = tenantTable(
  'case_status_snapshot',
  {
    id: id(),
    watchId: uuid('watch_id').notNull(),
    /** The parsed status fields (next date, stage, bench, orders), as the adapter parser returns them. */
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull(),
    /** sha256 hex of the canonical `fields`. */
    contentHash: text('content_hash').notNull(),
    via: text('via').$type<CaseStatusVia>().notNull(),
    /** The fetch tier a server lookup used; null for a device lookup. */
    tierUsed: sourceMaxTier('tier_used'),
    costDollars: numeric('cost_dollars', { precision: 12, scale: 6 }).notNull().default('0'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('case_status_snapshot_watch_hash_uq').on(t.workspaceId, t.watchId, t.contentHash),
    foreignKey({
      name: 'case_status_snapshot_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'case_status_snapshot_watch_fk',
      columns: [t.workspaceId, t.watchId],
      foreignColumns: [caseWatch.workspaceId, caseWatch.id],
    }).onDelete('cascade'),
    check('case_status_snapshot_via_chk', sql`via in ${inList(CASE_STATUS_VIA)}`),
    check('case_status_snapshot_fields_chk', sql`jsonb_typeof(fields) = 'object'`),
    check('case_status_snapshot_hash_chk', sql`content_hash ~ '^[0-9a-f]{64}$'`),
    check('case_status_snapshot_cost_chk', sql`cost_dollars >= 0`),
    provenanceCheck('case_status_snapshot'),
  ],
);
