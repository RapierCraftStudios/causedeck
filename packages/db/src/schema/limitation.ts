// Limitation tracker tables (#84, part 1): `limitation_rule` is a global-or-workspace table
// (`globalOrWorkspaceTable()`): a null `workspace_id` is a platform rule from counsel's rule table
// (#120), visible to every workspace only once `reviewed` is true (the `reviewed_only` restrictive
// policy in the migration); a workspace id is that
// workspace's own rule. `limitation_computation` is the tenant record of one computation for a
// matter. The gate is the flag `limitation.enabled`; see docs/adr/0049-limitation-rule-tables.md.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
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

/** These mirror the enums in `@causedeck/validators/limitation` (CHECKs). */
export const LIMITATION_START_EVENTS = [
  'cause_of_action',
  'knowledge',
  'order_date',
  'filing_date',
  'custom',
] as const;
export const LIMITATION_PERIOD_UNITS = ['days', 'months', 'years'] as const;
export const LIMITATION_COMPUTATION_STATUSES = ['proposed', 'confirmed', 'superseded'] as const;

export const limitationRule = globalOrWorkspaceTable(
  'limitation_rule',
  {
    id: id(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    statute: text('statute').notNull(),
    periodValue: integer('period_value').notNull(),
    periodUnit: text('period_unit').notNull(),
    startEvent: text('start_event').notNull(),
    condonable: boolean('condonable').notNull().default(true),
    citation: text('citation'),
    /** Counsel sign-off (#120). A platform rule is invisible to workspaces until true. */
    reviewed: boolean('reviewed').notNull().default(false),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    tableVersion: text('table_version').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('limitation_rule_scope_code_version_uq')
      .on(t.workspaceId, t.code, t.tableVersion)
      .nullsNotDistinct(),
    check(
      'limitation_rule_period_unit_chk',
      sql`period_unit in ${inList(LIMITATION_PERIOD_UNITS)}`,
    ),
    check(
      'limitation_rule_start_event_chk',
      sql`start_event in ${inList(LIMITATION_START_EVENTS)}`,
    ),
    check('limitation_rule_period_value_chk', sql`period_value > 0`),
    check('limitation_rule_reviewed_chk', sql`not reviewed or reviewed_at is not null`),
  ],
);

export const limitationComputation = tenantTable(
  'limitation_computation',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    /** Single-column FK into a global-or-workspace table; `app_reference_scope_guard` checks the scope. */
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => limitationRule.id, { onDelete: 'restrict' }),
    input: jsonb('input').notNull(),
    result: jsonb('result').notNull(),
    startDate: date('start_date').notNull(),
    expiresOn: date('expires_on').notNull(),
    status: text('status').notNull().default('proposed'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('limitation_computation_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('limitation_computation_matter_idx').on(t.workspaceId, t.matterId),
    index('limitation_computation_rule_id_idx').on(t.ruleId),
    foreignKey({
      name: 'limitation_computation_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'limitation_computation_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    check(
      'limitation_computation_status_chk',
      sql`status in ${inList(LIMITATION_COMPUTATION_STATUSES)}`,
    ),
    check('limitation_computation_dates_chk', sql`expires_on >= start_date`),
  ],
);
