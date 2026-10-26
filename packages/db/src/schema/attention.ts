// Attention snoozes (#70): `attention_snooze` records that a person snoozed a stale-matter flag until
// a day, with a reason, or dismissed it as intentionally dormant (`dismissed`, no `until`). A null
// `rule` covers every rule on the matter. The detector never writes: only a person does, and each
// write is audited. A tenant table under FORCE RLS via `tenantTable()`; rows cascade with their
// matter. `created_by` is a bare user id (no FK): the record outlives the account.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization } from './auth.ts';
import { matter } from './matter-graph.ts';

export const ATTENTION_SNOOZE_RULES = [
  'no_next_date',
  'past_date_no_outcome',
  'no_recent_update',
  'obligation_overdue_unowned',
] as const;
export type AttentionSnoozeRule = (typeof ATTENTION_SNOOZE_RULES)[number];

export const attentionSnooze = tenantTable(
  'attention_snooze',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    /** Null: every rule on the matter. */
    rule: text('rule').$type<AttentionSnoozeRule>(),
    /** The day the snooze ends; null for a dismissal. */
    until: date('until'),
    dismissed: boolean('dismissed').notNull().default(false),
    reason: text('reason'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attention_snooze_workspace_matter_idx').on(t.workspaceId, t.matterId),
    foreignKey({
      name: 'attention_snooze_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'attention_snooze_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    check(
      'attention_snooze_rule_chk',
      sql`rule is null or rule in ${inList(ATTENTION_SNOOZE_RULES)}`,
    ),
    // A snooze ends on a day and carries its reason; a dismissal has no end day.
    check(
      'attention_snooze_shape_chk',
      sql`(dismissed and until is null) or (not dismissed and until is not null and reason is not null and btrim(reason) <> '')`,
    ),
  ],
);
