// Brief sharing and referral (#507). `brief_share` is a workspace's expiring, revocable link to one
// brief: it stores a sanitised snapshot (never live matter rows) and only the sha-256 of the token.
// `referral` and `referral_credit` are global (GLOBAL_TABLES): they hold user ids, a share id and
// month counts only, so the funnel and the billing credit read them without a workspace.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

/** What a share exposes: the brief's own lines as text, no ids, no private notes, no strategy. */
export interface SharedBriefSnapshot {
  matterTitle: string;
  synopsis: string | null;
  stage: string | null;
  lastOrder: string[];
  lastHearing: string | null;
  openObligations: { text: string; dueDate: string | null }[];
  assembledAt: string;
}

export const briefShare = tenantTable(
  'brief_share',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    snapshot: jsonb('snapshot').$type<SharedBriefSnapshot>().notNull(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('brief_share_token_hash_uq').on(t.tokenHash),
    foreignKey({
      name: 'brief_share_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('brief_share_snapshot_chk', sql`jsonb_typeof(${t.snapshot}) = 'object'`),
  ],
);

/** One row per invited user: they claimed a share (accepted) and later imported it (activated). */
export const referral = pgTable(
  'referral',
  {
    id: id(),
    shareId: uuid('share_id').notNull(),
    referrerUserId: uuid('referrer_user_id').notNull(),
    inviteeUserId: uuid('invitee_user_id').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'referral_referrer_user_id_fk',
      columns: [t.referrerUserId],
      foreignColumns: [user.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'referral_invitee_user_id_fk',
      columns: [t.inviteeUserId],
      foreignColumns: [user.id],
    }).onDelete('cascade'),
    uniqueIndex('referral_invitee_uq').on(t.inviteeUserId),
    index('referral_referrer_idx').on(t.referrerUserId),
  ],
);

/** The free months a referral earned, one row per side; billing applies them (`applied_at`). */
export const referralCredit = pgTable(
  'referral_credit',
  {
    id: id(),
    referralId: uuid('referral_id')
      .notNull()
      .references(() => referral.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    side: text('side').notNull().$type<'referrer' | 'invitee'>(),
    months: integer('months').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'referral_credit_user_id_fk',
      columns: [t.userId],
      foreignColumns: [user.id],
    }).onDelete('cascade'),
    uniqueIndex('referral_credit_referral_side_uq').on(t.referralId, t.side),
    index('referral_credit_user_idx').on(t.userId),
    check('referral_credit_side_chk', sql`side in ('referrer', 'invitee')`),
    check('referral_credit_months_chk', sql`months > 0`),
  ],
);
