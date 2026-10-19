// Notification tables (#194, #23; spike §4.2). `notification` and `notification_pref` are tenant
// tables built with `tenantTable()` (FORCE RLS, `ws_isolation`), each row also owned by one user:
// the service in `@causedeck/notifications` filters by user inside the workspace. `push_subscription`
// (per user, any workspace; owner-checked by the push service, #197) and `email_suppression` (per
// address, #195) carry no workspace and are global (GLOBAL_TABLES).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push'] as const;
export const NOTIFICATION_DIGESTS = ['instant', 'daily', 'off'] as const;
export const EMAIL_SUPPRESSION_REASONS = ['bounce', 'complaint', 'manual'] as const;

export const notificationChannel = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationDigest = pgEnum('notification_digest', NOTIFICATION_DIGESTS);

const userRef = () =>
  uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

/** One in-app notification for one member; email and push deliveries reference it by id. */
export const notification = tenantTable(
  'notification',
  {
    id: id(),
    userId: userRef(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    href: text('href'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Repeats of the same key for the same member in the same workspace are dropped. */
    dedupeKey: text('dedupe_key'),
  },
  (t) => [
    foreignKey({
      name: 'notification_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    index('notification_workspace_user_created_idx').on(t.workspaceId, t.userId, t.createdAt),
    uniqueIndex('notification_dedupe_uq')
      .on(t.workspaceId, t.userId, t.dedupeKey)
      .where(sql`dedupe_key is not null`),
  ],
);

/** A member's choice per category and channel; absent rows fall back to the category default. */
export const notificationPref = tenantTable(
  'notification_pref',
  {
    userId: userRef(),
    category: text('category').notNull(),
    channel: notificationChannel('channel').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    digest: notificationDigest('digest').notNull().default('instant'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'notification_pref_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    primaryKey({
      name: 'notification_pref_pkey',
      columns: [t.workspaceId, t.userId, t.category, t.channel],
    }),
  ],
);

/**
 * A member's delivery settings in one workspace (#196). `court_hours_quiet` is the `Do not push
 * during court hours` toggle (10:30-17:00 local): scheduled sends such as the daily digest skip a
 * quiet window. No row means no quiet hours.
 */
export const notificationSetting = tenantTable(
  'notification_setting',
  {
    userId: userRef(),
    courtHoursQuiet: boolean('court_hours_quiet').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'notification_setting_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    primaryKey({ name: 'notification_setting_pkey', columns: [t.workspaceId, t.userId] }),
  ],
);

/** A browser's Web Push subscription; per user, global, revoked on 404/410 (#197). */
export const pushSubscription = pgTable(
  'push_subscription',
  {
    id: id(),
    userId: userRef(),
    endpoint: text('endpoint').notNull().unique('push_subscription_endpoint_uq'),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('push_subscription_user_id_idx').on(t.userId)],
);

/** Addresses never emailed again after a bounce or complaint (#195). */
export const emailSuppression = pgTable(
  'email_suppression',
  {
    email: citext('email').primaryKey(),
    reason: text('reason').notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('email_suppression_reason_chk', sql`reason in ${inList(EMAIL_SUPPRESSION_REASONS)}`),
  ],
);
