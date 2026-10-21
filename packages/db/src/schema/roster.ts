// Effective-dated bench rosters (#384, part 1 of #39; ADR 0017): `bench_roster`,
// `bench_roster_entry` and `bench_change_alert`, tenant tables under FORCE RLS via `tenantTable()`.
// A roster is lawyer-supplied and workspace-scoped, for a catalogue forum or one of the workspace's
// own; its entries map a court hall to a bench for the roster's period. At most one `active` roster
// per workspace and forum covers any day: `bench_roster_active_period_excl` is a btree_gist
// exclusion constraint over `daterange(effective_from, effective_to, '[)')` (null `effective_to` is
// open-ended), hand-written in migration 0045 because Drizzle cannot declare EXCLUDE. Forum, hall
// and bench references are single-column FKs guarded by `<table>_<column>_scope_guard` triggers
// (mode `same_or_global`, migration 0045). An entry names a bench, never judges: the court-published
// composition lives only in `bench.judges`, and nothing here aggregates by judge (PX-9, ME-6).
// Immutability once active and supersede are the roster services' rules (#387).
//
// Delete actions: entries cascade with their roster; alerts keep the proceeding and roster they cite
// (NO ACTION; the erase purges them first). `imported_by` and `source_document_id` are
// `ON DELETE SET NULL (<column>)` in migration 0045 (a plain composite SET NULL would also null
// `workspace_id`); Drizzle records them as `set null`.
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, member, organization } from './auth.ts';
import { bench, courtHall, forum } from './court.ts';
import { document } from './documents.ts';
import { proceeding } from './proceedings.ts';

/** A roster version's lifecycle: drafted on import, active once confirmed, superseded later. */
export const BENCH_ROSTER_STATUSES = ['draft', 'active', 'superseded'] as const;
export type BenchRosterStatus = (typeof BENCH_ROSTER_STATUSES)[number];

/** Why a proceeding's bench changed under a new roster: its hall moved, or its portfolio did. */
export const BENCH_CHANGE_REASONS = ['hall', 'portfolio'] as const;
export type BenchChangeReason = (typeof BENCH_CHANGE_REASONS)[number];

export const BENCH_CHANGE_ALERT_STATUSES = ['open', 'dismissed'] as const;
export type BenchChangeAlertStatus = (typeof BENCH_CHANGE_ALERT_STATUSES)[number];

/** Which matters a roster entry's bench takes (all present keys must match). */
export interface PortfolioRule {
  caseTypes?: string[];
  yearFrom?: number;
  yearTo?: number;
  subjectTags?: string[];
}

export const benchRoster = tenantTable(
  'bench_roster',
  {
    id: id(),
    /** A catalogue forum or one of the workspace's own (scope-guarded, ADR 0013). */
    forumId: uuid('forum_id')
      .notNull()
      .references(() => forum.id, { onDelete: 'restrict' }),
    effectiveFrom: date('effective_from').notNull(),
    /** Exclusive; null while the roster has no announced end. */
    effectiveTo: date('effective_to'),
    status: text('status').$type<BenchRosterStatus>().notNull().default('draft'),
    /** Per workspace and forum, from 1. */
    version: integer('version').notNull(),
    sourceDocumentId: uuid('source_document_id'),
    /** The member who imported it; null once their membership is gone. */
    importedBy: uuid('imported_by'),
    note: text('note'),
    ...timestamps(),
  },
  (t) => [
    unique('bench_roster_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('bench_roster_forum_version_uq').on(t.workspaceId, t.forumId, t.version),
    index('bench_roster_workspace_forum_from_idx').on(t.workspaceId, t.forumId, t.effectiveFrom),
    foreignKey({
      name: 'bench_roster_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'bench_roster_source_document_fk',
      columns: [t.workspaceId, t.sourceDocumentId],
      foreignColumns: [document.workspaceId, document.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'bench_roster_imported_by_fk',
      columns: [t.workspaceId, t.importedBy],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('set null'),
    check('bench_roster_status_chk', sql`status in ${inList(BENCH_ROSTER_STATUSES)}`),
    check('bench_roster_version_chk', sql`version > 0`),
    check('bench_roster_period_chk', sql`effective_to is null or effective_to > effective_from`),
  ],
);

export const benchRosterEntry = tenantTable(
  'bench_roster_entry',
  {
    id: id(),
    rosterId: uuid('roster_id').notNull(),
    /** The catalogue or workspace hall, when the hall number resolved to one. */
    hallId: uuid('hall_id').references(() => courtHall.id, { onDelete: 'restrict' }),
    /** As printed; text because halls such as "12A" exist. */
    hallNo: text('hall_no').notNull(),
    /** A catalogue bench or one of the workspace's own (scope-guarded, ADR 0013). */
    benchId: uuid('bench_id')
      .notNull()
      .references(() => bench.id, { onDelete: 'restrict' }),
    /** The portfolio as printed. */
    portfolioText: text('portfolio_text').notNull().default(''),
    /** The portfolio as the lawyer confirmed it, when it could be structured. */
    portfolioRule: jsonb('portfolio_rule').$type<PortfolioRule>(),
    ...timestamps(),
  },
  (t) => [
    unique('bench_roster_entry_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('bench_roster_entry_workspace_roster_idx').on(t.workspaceId, t.rosterId),
    foreignKey({
      name: 'bench_roster_entry_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'bench_roster_entry_roster_fk',
      columns: [t.workspaceId, t.rosterId],
      foreignColumns: [benchRoster.workspaceId, benchRoster.id],
    }).onDelete('cascade'),
    check('bench_roster_entry_hall_no_chk', sql`btrim(hall_no) <> ''`),
    check(
      'bench_roster_entry_portfolio_rule_chk',
      sql`portfolio_rule is null or jsonb_typeof(portfolio_rule) = 'object'`,
    ),
  ],
);

export const benchChangeAlert = tenantTable(
  'bench_change_alert',
  {
    id: id(),
    proceedingId: uuid('proceeding_id').notNull(),
    /** The roster whose period changed the proceeding's bench. */
    rosterId: uuid('roster_id').notNull(),
    /** Null when the proceeding had no bench before. */
    oldBenchId: uuid('old_bench_id').references(() => bench.id, { onDelete: 'restrict' }),
    newBenchId: uuid('new_bench_id')
      .notNull()
      .references(() => bench.id, { onDelete: 'restrict' }),
    reason: text('reason').$type<BenchChangeReason>().notNull(),
    status: text('status').$type<BenchChangeAlertStatus>().notNull().default('open'),
    ...timestamps(),
  },
  (t) => [
    unique('bench_change_alert_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('bench_change_alert_proceeding_roster_uq').on(t.proceedingId, t.rosterId),
    index('bench_change_alert_workspace_status_idx').on(t.workspaceId, t.status),
    foreignKey({
      name: 'bench_change_alert_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'bench_change_alert_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }),
    foreignKey({
      name: 'bench_change_alert_roster_fk',
      columns: [t.workspaceId, t.rosterId],
      foreignColumns: [benchRoster.workspaceId, benchRoster.id],
    }),
    check('bench_change_alert_reason_chk', sql`reason in ${inList(BENCH_CHANGE_REASONS)}`),
    check('bench_change_alert_status_chk', sql`status in ${inList(BENCH_CHANGE_ALERT_STATUSES)}`),
  ],
);
