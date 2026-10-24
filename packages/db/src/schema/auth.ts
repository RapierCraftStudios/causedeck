// Better Auth tables (#12, spike §4.2, ADR 0004). Columns follow `@better-auth/cli generate` for
// the organization, magicLink, passkey and twoFactor plugins plus database rate limiting, edited to
// uuid ids and explicit snake_case names. Property keys stay Better Auth's field names so the
// Drizzle adapter (#152) needs no field mapping.
//
// `user`, `session`, `account`, `verification`, `passkey`, `two_factor` and `rate_limit` are global
// (see GLOBAL_TABLES). `organization` is the workspace; `member` and `invitation` are tenant tables
// whose `organizationId` is stored as `workspace_id`, so RLS (#19) applies to them as to any other.
//
// Single source of truth (#177): the workspace is Better Auth's `organization`, and membership and
// invitations are its `member` and `invitation`. The workspace domain columns (kind, plan, soft
// delete, member status, invitation token hash, ...) extend those tables here instead of living in
// duplicate tables or views. Every added column is nullable or defaulted so the organization plugin,
// which only writes its own fields, keeps working. Workspace-only tables (`workspace_settings`,
// `workspace_slug_history`) live in `workspace.ts`.
import { LOCALES } from '@causedeck/i18n/locales';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, id, timestamps, workspaceIndex } from '../columns.ts';

/**
 * Workspace membership roles, mirrored from `ROLES` in `@causedeck/auth` (which depends on this
 * package, not the other way round). A test keeps the two lists equal.
 */
export const WORKSPACE_ROLES = ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const;

/** UI locales, owned by `@causedeck/i18n`; re-exported for the `user_locale_chk` check. */
export { LOCALES };

/** A solo practice, a shared chamber with seats (#18), or a bank, NBFC or ARC (#661). */
export const WORKSPACE_KINDS = ['solo', 'chamber', 'institution'] as const;

/** Membership lifecycle; only `active` members see the workspace or count as seats. */
export const MEMBER_STATUSES = ['active', 'suspended', 'removed'] as const;

export const inList = (values: readonly string[]) =>
  sql.raw(`(${values.map((v) => `'${v}'`).join(', ')})`);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const user = pgTable(
  'user',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull().unique('user_email_uq'),
    emailVerified: boolean('email_verified').notNull().default(false),
    /** E.164, set when the user signs up or in with a phone OTP (#503); unique when present. */
    phoneNumber: text('phone_number').unique('user_phone_number_uq'),
    phoneNumberVerified: boolean('phone_number_verified').notNull().default(false),
    image: text('image'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    locale: text('locale').notNull().default('en'),
    ...timestamps(),
  },
  () => [check('user_locale_chk', sql`locale in ${inList(LOCALES)}`)],
);

export const organization = pgTable(
  'organization',
  {
    id: id(),
    name: text('name').notNull(),
    slug: citext('slug').notNull().unique('organization_slug_uq'),
    logo: text('logo'),
    metadata: text('metadata'),
    kind: text('kind').notNull().default('solo'),
    planId: text('plan_id'),
    /** Null for workspaces created by Better Auth directly or whose creator was deleted. */
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** Soft delete: hidden from membership queries and slug resolution. Hard delete is #31. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  () => [check('organization_kind_chk', sql`kind in ${inList(WORKSPACE_KINDS)}`)],
);

export const session = pgTable(
  'session',
  {
    id: id(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique('session_token_uq'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: uuid('active_organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    /** The session's last passkey or TOTP verification, for step-up checks (#304). */
    stepUpAt: timestamp('step_up_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: id(),
    /**
     * For magic links this is the token itself, so it is only ever stored hashed: #152 configures
     * `magicLink({ storeToken: 'hashed' })`, which writes the SHA-256 digest, never the plaintext.
     */
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const passkey = pgTable(
  'passkey',
  {
    id: id(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    aaguid: text('aaguid'),
    createdAt: createdAt(),
  },
  (t) => [
    index('passkey_user_id_idx').on(t.userId),
    index('passkey_credential_id_idx').on(t.credentialID),
  ],
);

export const twoFactor = pgTable(
  'two_factor',
  {
    id: id(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [
    index('two_factor_user_id_idx').on(t.userId),
    index('two_factor_secret_idx').on(t.secret),
  ],
);

export const rateLimit = pgTable('rate_limit', {
  id: id(),
  key: text('key').notNull().unique('rate_limit_key_uq'),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

export const member = pgTable(
  'member',
  {
    id: id(),
    organizationId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** When the current `role` was granted; starts the owner 2FA grace (#290). */
    roleGrantedAt: timestamp('role_granted_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    workspaceIndex('member', t.organizationId),
    uniqueIndex('member_workspace_user_uq').on(t.organizationId, t.userId),
    // Target of composite `(workspace_id, *_member_id)` FKs from the matter graph (#344).
    unique('member_workspace_id_id_uq').on(t.organizationId, t.id),
    index('member_user_id_idx').on(t.userId),
    check('member_role_chk', sql`role in ${inList(WORKSPACE_ROLES)}`),
    check('member_status_chk', sql`status in ${inList(MEMBER_STATUSES)}`),
  ],
);

export const invitation = pgTable(
  'invitation',
  {
    id: id(),
    organizationId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** SHA-256 of the invite token (#178); the plaintext is never stored. */
    tokenHash: text('token_hash'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    workspaceIndex('invitation', t.organizationId),
    index('invitation_email_idx').on(t.email),
    uniqueIndex('invitation_token_hash_uq').on(t.tokenHash),
    check('invitation_role_chk', sql`role in ${inList(WORKSPACE_ROLES)}`),
  ],
);
