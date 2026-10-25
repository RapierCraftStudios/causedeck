// Court-day reminder dispatch (#64): one row per (member, kind, local date, channel) the reminder
// jobs have sent or are sending. The unique key is the idempotency guard: a job inserts the row
// with ON CONFLICT DO NOTHING before it sends and sends nothing when no row was inserted, so a
// retried job never sends twice. A tenant table under FORCE RLS.
import { foreignKey, text, timestamp, unique, uuid, date, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { member, organization } from './auth.ts';

export const REMINDER_KINDS = ['evening', 'morning', 'outcome_missing'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const reminderDispatch = tenantTable(
  'reminder_dispatch',
  {
    id: id(),
    memberId: uuid('member_id').notNull(),
    kind: text('kind').notNull().$type<ReminderKind>(),
    forDate: date('for_date', { mode: 'string' }).notNull(),
    channel: text('channel').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('reminder_dispatch_member_kind_date_channel_uq').on(
      t.memberId,
      t.kind,
      t.forDate,
      t.channel,
    ),
    foreignKey({
      name: 'reminder_dispatch_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'reminder_dispatch_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('cascade'),
    check(
      'reminder_dispatch_kind_chk',
      sql`${t.kind} in ('evening', 'morning', 'outcome_missing')`,
    ),
    check('reminder_dispatch_channel_chk', sql`${t.channel} in ('in_app', 'push', 'email')`),
  ],
);
