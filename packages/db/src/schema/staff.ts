// Platform staff and consented support sessions (#308, part of #27; spike §4.2, §6; PRD PL-6).
//
// `staff_user` is global (GLOBAL_TABLES): one row per platform staff member. The app and clerk
// roles may only read it (migration 0024 revokes INSERT, UPDATE and DELETE), so staff accounts are
// created and disabled only by the operator CLI (`pnpm --filter @causedeck/admin staff:add`), which
// connects as the owner role. A disabled row (`disabled_at` set) is not staff.
//
// `support_session` is a tenant table under FORCE RLS: a staff member's request to see one
// workspace, granted, denied or revoked by its owner, time-boxed by `expires_at` (at most 4 h after
// `granted_at`). Besides `ws_isolation`, the `staff_self` SELECT policy lets a staff member list
// their own sessions from a user scope (no workspace pinned). Expiry and the end-on-disable sweep
// run in the owner-defined `app_expire_support_sessions()` and `app_end_staff_support_sessions()`.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

export const STAFF_ROLES = ['support', 'ops', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const SUPPORT_SESSION_SCOPES = ['metadata', 'view'] as const;
export type SupportSessionScope = (typeof SUPPORT_SESSION_SCOPES)[number];

export const SUPPORT_SESSION_STATUSES = [
  'requested',
  'granted',
  'denied',
  'expired',
  'ended',
] as const;
export type SupportSessionStatus = (typeof SUPPORT_SESSION_STATUSES)[number];

/** The longest grant, in minutes (4 h); a CHECK on `support_session` enforces it too. */
export const SUPPORT_SESSION_MAX_MINUTES = 240;

export const staffRole = pgEnum('staff_role', STAFF_ROLES);
export const supportSessionScope = pgEnum('support_session_scope', SUPPORT_SESSION_SCOPES);
export const supportSessionStatus = pgEnum('support_session_status', SUPPORT_SESSION_STATUSES);

export const staffUser = pgTable('staff_user', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: staffRole('role').notNull(),
  /** The staff member who added this one; null when an operator bootstrapped it. */
  createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
});

export const supportSession = tenantTable(
  'support_session',
  {
    id: id(),
    // References `user`, not `staff_user`: core checks the requester is enabled staff, and the
    // `staff_self` policy re-checks it on every read.
    requestedByStaff: uuid('requested_by_staff')
      .notNull()
      .references(() => user.id),
    grantedByUser: uuid('granted_by_user').references(() => user.id, { onDelete: 'set null' }),
    scope: supportSessionScope('scope').notNull().default('metadata'),
    reason: text('reason').notNull(),
    status: supportSessionStatus('status').notNull().default('requested'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('support_session_workspace_status_idx').on(t.workspaceId, t.status),
    index('support_session_staff_status_idx').on(t.requestedByStaff, t.status),
    foreignKey({
      name: 'support_session_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('support_session_reason_chk', sql`length(btrim(reason)) between 1 and 500`),
    check(
      'support_session_granted_chk',
      sql`status <> 'granted' or (granted_at is not null and expires_at is not null)`,
    ),
    check(
      'support_session_window_chk',
      sql`expires_at is null or (granted_at is not null and expires_at > granted_at and expires_at <= granted_at + interval '240 minutes')`,
    ),
  ],
);
