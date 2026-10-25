// WhatsApp number link and OTP challenge (#678, part 1 of #502, D-029). `whatsapp_link` is one
// member's verified WhatsApp number in one workspace: a row exists only after the OTP was verified
// with consent, so it carries `verified_at` and `consent_at`, and unlinking deletes it. Messages
// may only ever target this number of this user. `whatsapp_otp_challenge` is the pending
// verification (one per member): it holds a hash of the code, never the code, with an expiry and an
// attempt cap. `whatsapp_inbound_message` (#680) records one forwarded provider message once per
// workspace so a redelivery is a no-op. Tenant tables under FORCE RLS via `tenantTable()`.
import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

export const WHATSAPP_E164_PATTERN = '^\\+[1-9][0-9]{7,14}$';
export const WHATSAPP_OTP_MAX_ATTEMPTS = 5;

const userRef = () =>
  uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

export const whatsappLink = tenantTable(
  'whatsapp_link',
  {
    id: id(),
    userId: userRef(),
    e164: text('e164').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    /** Notification category keys the member opted in to on WhatsApp; empty means none. */
    categories: text('categories')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'whatsapp_link_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    unique('whatsapp_link_workspace_user_uq').on(t.workspaceId, t.userId),
    check('whatsapp_link_e164_chk', sql`e164 ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

export const whatsappOtpChallenge = tenantTable(
  'whatsapp_otp_challenge',
  {
    id: id(),
    userId: userRef(),
    e164: text('e164').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    /** The member's opt-in, given when the code was requested; copied to the link on verify. */
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'whatsapp_otp_challenge_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    unique('whatsapp_otp_challenge_workspace_user_uq').on(t.workspaceId, t.userId),
    check('whatsapp_otp_challenge_e164_chk', sql`e164 ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('whatsapp_otp_challenge_attempts_chk', sql`attempts between 0 and 5`),
  ],
);

export const WHATSAPP_INBOUND_STATUSES = ['received', 'stored', 'dropped'] as const;
export type WhatsAppInboundStatus = (typeof WHATSAPP_INBOUND_STATUSES)[number];

/** One forwarded provider message of a linked member; unique per workspace by provider id. */
export const whatsappInboundMessage = tenantTable(
  'whatsapp_inbound_message',
  {
    id: id(),
    userId: userRef(),
    /** The provider's message id (`wamid...`); the dedupe key within a workspace. */
    providerMessageId: text('provider_message_id').notNull(),
    /** The provider's reference to the media; the job downloads it. */
    mediaId: text('media_id').notNull(),
    mime: text('mime').notNull(),
    filename: text('filename').notNull(),
    status: text('status').$type<WhatsAppInboundStatus>().notNull().default('received'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'whatsapp_inbound_message_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    unique('whatsapp_inbound_message_workspace_provider_id_uq').on(
      t.workspaceId,
      t.providerMessageId,
    ),
    check('whatsapp_inbound_message_status_chk', sql`status in ('received', 'stored', 'dropped')`),
  ],
);
