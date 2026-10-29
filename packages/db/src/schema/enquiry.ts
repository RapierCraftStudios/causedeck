// The inbound enquiry log (#87, part 1; ADR 0047): `enquiry` is a person asking the chamber to take
// work, `enquiry_party` the names on it (our prospective client, the adverse side) and
// `conflict_check_result` one stored run of the conflict check (hits, never a verdict). All three are
// tenant tables under FORCE RLS. Closed enquiries are deleted by the retention job after the
// workspace's `enquiry_retention_months`; nothing here is ever sent anywhere.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';

/** Mirror `ENQUIRY_STATUSES`, `ENQUIRY_CHANNELS` and `ENQUIRY_PARTY_SIDES` in `@causedeck/validators/enquiry`. */
export const ENQUIRY_STATUS_VALUES = [
  'logged',
  'checked',
  'accepted_as_matter',
  'declined',
  'referred',
  'closed',
] as const;
export const ENQUIRY_CHANNEL_VALUES = [
  'phone',
  'email',
  'walk_in',
  'referral',
  'web',
  'other',
] as const;
export const ENQUIRY_PARTY_SIDE_VALUES = ['client', 'adverse'] as const;

export const enquiry = tenantTable(
  'enquiry',
  {
    id: id(),
    status: text('status').notNull().default('logged'),
    channel: text('channel').notNull().default('other'),
    enquirerName: text('enquirer_name').notNull(),
    /** E.164. */
    phone: text('phone'),
    email: text('email'),
    summary: text('summary').notNull(),
    practiceArea: text('practice_area'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /** The `proposal` that creates the matter once the enquiry is accepted; no direct matter write. */
    proposalId: uuid('proposal_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedReason: text('closed_reason'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('enquiry_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'enquiry_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('enquiry_status_chk', sql`status in ${inList(ENQUIRY_STATUS_VALUES)}`),
    check('enquiry_channel_chk', sql`channel in ${inList(ENQUIRY_CHANNEL_VALUES)}`),
    check('enquiry_closed_chk', sql`(status = 'closed') = (closed_at is not null)`),
    check('enquiry_phone_chk', sql`phone is null or phone ~ '^[+][1-9][0-9]{6,14}$'`),
  ],
);

export const enquiryParty = tenantTable(
  'enquiry_party',
  {
    id: id(),
    enquiryId: uuid('enquiry_id').notNull(),
    name: text('name').notNull(),
    side: text('side').notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'enquiry_party_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'enquiry_party_enquiry_fk',
      columns: [t.workspaceId, t.enquiryId],
      foreignColumns: [enquiry.workspaceId, enquiry.id],
    }).onDelete('cascade'),
    check('enquiry_party_side_chk', sql`side in ${inList(ENQUIRY_PARTY_SIDE_VALUES)}`),
  ],
);

export const conflictCheckResult = tenantTable(
  'conflict_check_result',
  {
    id: id(),
    enquiryId: uuid('enquiry_id').notNull(),
    checkedBy: uuid('checked_by').references(() => user.id, { onDelete: 'set null' }),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    partyCount: integer('party_count').notNull(),
    hitCount: integer('hit_count').notNull(),
    /** The ranked hits as returned to the advocate (matter, role, reason, score); never a verdict. */
    hits: jsonb('hits').$type<unknown[]>().notNull().default([]),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'conflict_check_result_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'conflict_check_result_enquiry_fk',
      columns: [t.workspaceId, t.enquiryId],
      foreignColumns: [enquiry.workspaceId, enquiry.id],
    }).onDelete('cascade'),
    check('conflict_check_result_counts_chk', sql`party_count >= 0 and hit_count >= 0`),
  ],
);
