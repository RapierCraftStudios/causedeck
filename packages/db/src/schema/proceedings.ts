// Proceedings of the matter graph (#346, part 3 of #32; #32 data contract, ADR 0013): `proceeding`
// and `proceeding_link`, tenant tables under FORCE RLS via `tenantTable()` that carry provenance. A
// proceeding is identified by forum x normalised `case_type_code` x `number` x `year` once
// numbered; before that by its filing, SR, FR, diary and CNR numbers. `forum_id` is a single-column
// FK into the global-or-workspace `forum` table, guarded by the `proceeding_forum_id_scope_guard`
// trigger (mode `same_or_global`: a catalogue forum or one of the workspace's own). `matter_id` and
// the provenance `anchor_id` are NO ACTION: a matter or anchor a proceeding cites stays until the
// proceeding goes (the erase purges proceedings first). `parent_proceeding_id` is `ON DELETE SET
// NULL (parent_proceeding_id)` in migration 0039. Links die with either end; the
// `proceeding_link_parent_of_cycle_guard` trigger (migration 0039) rejects a `parent_of` cycle.
// `proceeding_state_change` (#363, migration 0042, ADR 0014) is the append-only history of state
// transitions written by the matter-graph state machine; it dies with its proceeding, and its actor
// reference is cleared (SET NULL) when the actor's membership goes.
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, provenance, provenanceCheck, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, member, organization } from './auth.ts';
import { forum } from './court.ts';
import { anchor } from './documents.ts';
import { proceedingKind, proceedingState } from './enums.ts';
import { matter } from './matter-graph.ts';

/** The CNR (case number record) format: 16 upper-case letters and digits. */
export const CNR_PATTERN = '^[A-Z0-9]{16}$';

export const proceeding = tenantTable(
  'proceeding',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    /** A catalogue forum or one of the workspace's own (scope-guarded, ADR 0013). */
    forumId: uuid('forum_id')
      .notNull()
      .references(() => forum.id, { onDelete: 'restrict' }),
    kind: proceedingKind('kind').notNull().default('main'),
    /** Normalised: upper-case, no dots or spaces (e.g. `WP` for "W.P."). */
    caseTypeCode: text('case_type_code').notNull(),
    /** The case type as printed. */
    caseTypeRaw: text('case_type_raw'),
    /** Text: case numbers can carry suffixes. Required from `numbered` on. */
    number: text('number'),
    year: integer('year'),
    srNo: text('sr_no'),
    frNo: text('fr_no'),
    diaryNo: text('diary_no'),
    filingNo: text('filing_no'),
    cnr: text('cnr'),
    filingDate: date('filing_date'),
    state: proceedingState('state').notNull().default('filed'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    /** A miscellaneous petition or IA under its main proceeding. */
    parentProceedingId: uuid('parent_proceeding_id'),
    titlePetitioner: text('title_petitioner'),
    titleRespondent: text('title_respondent'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('proceeding_workspace_id_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('proceeding_identity_uq')
      .on(t.workspaceId, t.forumId, t.caseTypeCode, t.number, t.year)
      .where(sql`number is not null`),
    uniqueIndex('proceeding_cnr_uq')
      .on(t.workspaceId, t.cnr)
      .where(sql`cnr is not null`),
    index('proceeding_workspace_matter_idx').on(t.workspaceId, t.matterId),
    foreignKey({
      name: 'proceeding_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'proceeding_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }),
    foreignKey({
      name: 'proceeding_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    foreignKey({
      name: 'proceeding_parent_fk',
      columns: [t.workspaceId, t.parentProceedingId],
      foreignColumns: [t.workspaceId, t.id],
    }).onDelete('set null'),
    provenanceCheck('proceeding'),
    check(
      'proceeding_numbered_chk',
      sql`state not in ('numbered', 'disposed') or (number is not null and year is not null)`,
    ),
    check('proceeding_number_chk', sql`number is null or btrim(number) <> ''`),
    check('proceeding_year_chk', sql`year is null or (year >= 1800 and year <= 2200)`),
    check('proceeding_cnr_chk', sql`cnr is null or cnr ~ ${sql.raw(`'${CNR_PATTERN}'`)}`),
    check(
      'proceeding_case_type_code_chk',
      sql`case_type_code <> '' and case_type_code = upper(case_type_code) and case_type_code !~ '[.[:space:]]'`,
    ),
    check(
      'proceeding_not_parent_of_self_chk',
      sql`parent_proceeding_id is null or parent_proceeding_id <> id`,
    ),
  ],
);

export const PROCEEDING_LINK_KINDS = [
  'parent_of',
  'connected',
  'appeal_from',
  'lower_court',
] as const;
export type ProceedingLinkKind = (typeof PROCEEDING_LINK_KINDS)[number];

export const proceedingLink = tenantTable(
  'proceeding_link',
  {
    id: id(),
    fromProceedingId: uuid('from_proceeding_id').notNull(),
    toProceedingId: uuid('to_proceeding_id').notNull(),
    kind: text('kind').$type<ProceedingLinkKind>().notNull(),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('proceeding_link_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('proceeding_link_triple_uq').on(
      t.workspaceId,
      t.fromProceedingId,
      t.toProceedingId,
      t.kind,
    ),
    index('proceeding_link_workspace_to_idx').on(t.workspaceId, t.toProceedingId),
    foreignKey({
      name: 'proceeding_link_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'proceeding_link_from_fk',
      columns: [t.workspaceId, t.fromProceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'proceeding_link_to_fk',
      columns: [t.workspaceId, t.toProceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'proceeding_link_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('proceeding_link'),
    check('proceeding_link_kind_chk', sql`kind in ${inList(PROCEEDING_LINK_KINDS)}`),
    check('proceeding_link_not_self_chk', sql`from_proceeding_id <> to_proceeding_id`),
  ],
);

export const proceedingStateChange = tenantTable(
  'proceeding_state_change',
  {
    id: id(),
    proceedingId: uuid('proceeding_id').notNull(),
    fromState: proceedingState('from_state').notNull(),
    toState: proceedingState('to_state').notNull(),
    /** Why; required on a reopen (`disposed` -> `numbered`). */
    reason: text('reason'),
    /** Null once the actor's membership is gone (account deletion). */
    actorMemberId: uuid('actor_member_id'),
    /** The registry's cure deadline, only when entering `defects`. */
    cureDeadline: date('cure_deadline'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('proceeding_state_change_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('proceeding_state_change_workspace_proceeding_idx').on(
      t.workspaceId,
      t.proceedingId,
      t.changedAt,
    ),
    foreignKey({
      name: 'proceeding_state_change_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'proceeding_state_change_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'proceeding_state_change_actor_member_fk',
      columns: [t.workspaceId, t.actorMemberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'proceeding_state_change_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('proceeding_state_change'),
    check('proceeding_state_change_not_same_chk', sql`from_state <> to_state`),
    check('proceeding_state_change_reason_chk', sql`reason is null or btrim(reason) <> ''`),
    check(
      'proceeding_state_change_cure_deadline_chk',
      sql`cure_deadline is null or to_state = 'defects'`,
    ),
    check(
      'proceeding_state_change_reopen_reason_chk',
      sql`from_state <> 'disposed' or to_state <> 'numbered' or reason is not null`,
    ),
  ],
);
