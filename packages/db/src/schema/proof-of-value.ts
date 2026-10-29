// Proof-of-value instrumentation (#86, D-030): the preparedness tap, the weekly load pulse, the
// context test and each member's prompt preference. Workspace-internal measurement of the members'
// own experience: ids, small numbers, booleans, timestamps and one optional note capped at 140
// characters. No matter name, party name or other free text is stored (the schema test in
// `packages/core/src/pov/__tests__/schema-content.test.ts` asserts it). A removed member's rows go
// with the membership. `baseline` marks what was recorded in the workspace's first 7 days, the
// reference for the delta in the practice dashboard (#85).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { member, organization } from './auth.ts';
import { appearance } from './docket.ts';
import { matter } from './matter-graph.ts';

/** The longest optional note on a rating; mirrors `POV_NOTE_MAX` in `@causedeck/validators`. */
export const POV_NOTE_MAX = 140;

const scale = (name: string) => smallint(name);
const scaleCheck = (column: string) => sql.raw(`${column} is null or ${column} between 1 and 5`);

/**
 * One row per member and appearance, written when the tap is first shown (neither `rating` nor
 * `skipped_at`), then updated by a rating or a skip. A tap after a skip, or a second tap, updates it.
 */
export const preparednessRating = tenantTable(
  'preparedness_rating',
  {
    id: id(),
    appearanceId: uuid('appearance_id').notNull(),
    memberId: uuid('member_id').notNull(),
    rating: scale('rating'),
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    baseline: boolean('baseline').notNull().default(false),
    note: varchar('note', { length: POV_NOTE_MAX }),
    ...timestamps(),
  },
  (t) => [
    unique('preparedness_rating_member_appearance_uq').on(
      t.workspaceId,
      t.appearanceId,
      t.memberId,
    ),
    foreignKey({
      name: 'preparedness_rating_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'preparedness_rating_appearance_fk',
      columns: [t.workspaceId, t.appearanceId],
      foreignColumns: [appearance.workspaceId, appearance.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'preparedness_rating_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('cascade'),
    check('preparedness_rating_rating_chk', sql`${scaleCheck('rating')}`),
    check(
      'preparedness_rating_answer_chk',
      sql`not (rating is not null and skipped_at is not null)`,
    ),
    check(
      'preparedness_rating_note_chk',
      sql`note is null or (position(chr(10) in note) = 0 and position(chr(13) in note) = 0)`,
    ),
  ],
);

/** One row per member and ISO week: answered (all three items) or dismissed (none). */
export const loadPulse = tenantTable(
  'load_pulse',
  {
    id: id(),
    memberId: uuid('member_id').notNull(),
    /** `YYYY-Www` in IST. */
    isoWeek: text('iso_week').notNull(),
    demand: scale('demand'),
    worry: scale('worry'),
    effort: scale('effort'),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    baseline: boolean('baseline').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique('load_pulse_member_week_uq').on(t.workspaceId, t.memberId, t.isoWeek),
    foreignKey({
      name: 'load_pulse_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'load_pulse_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('cascade'),
    check('load_pulse_iso_week_chk', sql`iso_week ~ '^[0-9]{4}-W[0-9]{2}$'`),
    check(
      'load_pulse_scale_chk',
      sql`${scaleCheck('demand')} and ${scaleCheck('worry')} and ${scaleCheck('effort')}`,
    ),
    check(
      'load_pulse_answer_chk',
      sql`(dismissed_at is null and demand is not null and worry is not null and effort is not null) or (dismissed_at is not null and demand is null and worry is null and effort is null)`,
    ),
  ],
);

/** A timed run on a matter the owner chose; `questions` holds the answers (ids, marks, times). */
export const contextTestResult = tenantTable(
  'context_test_result',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    memberId: uuid('member_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    elapsedMs: integer('elapsed_ms'),
    questions: jsonb('questions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'context_test_result_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'context_test_result_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'context_test_result_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('cascade'),
    check('context_test_result_elapsed_chk', sql`elapsed_ms is null or elapsed_ms >= 0`),
    check('context_test_result_finished_chk', sql`(finished_at is null) = (elapsed_ms is null)`),
    check('context_test_result_questions_chk', sql`jsonb_typeof(questions) = 'array'`),
  ],
);

/** A member's prompt preference; no row means prompts are on. */
export const povPrefs = tenantTable(
  'pov_prefs',
  {
    memberId: uuid('member_id').notNull(),
    promptsEnabled: boolean('prompts_enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pov_prefs_pkey', columns: [t.workspaceId, t.memberId] }),
    foreignKey({
      name: 'pov_prefs_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'pov_prefs_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('cascade'),
  ],
);
