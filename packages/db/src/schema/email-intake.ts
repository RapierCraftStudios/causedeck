// Email forward-in intake (#54 part 2): the per-user intake address, the sender allow-list and the
// received-message ledger. Tenant tables under FORCE RLS via `tenantTable()`.
//
// `intake_address`: `u-` + 10 random base32 chars (a-z, 2-7) at the intake domain, never derived
// from the user. A rotated or revoked row keeps its `(local_part, domain)` forever (the unique
// constraint is not partial) so a retired address can never be handed out again; only one row per
// (workspace, user) is `active`. Inbound mail resolves an address to a workspace through the
// SECURITY DEFINER function `app_resolve_intake_address` (migration 0058), which returns a row
// only for active addresses, so an unknown and a revoked address look the same.
//
// `intake_allowlist`: an exact address or a domain the workspace accepts forwards from.
// `intake_message`: one row per inbound message (message id unique per workspace); the raw MIME
// object is referenced by `raw_mime_ref` and deleted at `raw_expires_at` (30 days) unless pinned.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';

export const INTAKE_ADDRESS_STATUSES = ['active', 'revoked'] as const;
export type IntakeAddressStatus = (typeof INTAKE_ADDRESS_STATUSES)[number];

export const INTAKE_ALLOWLIST_KINDS = ['court', 'efiling', 'self', 'briefing_counsel'] as const;
export type IntakeAllowlistKind = (typeof INTAKE_ALLOWLIST_KINDS)[number];

export const INTAKE_MESSAGE_STATUSES = ['received', 'processed', 'quarantined', 'dropped'] as const;
export type IntakeMessageStatus = (typeof INTAKE_MESSAGE_STATUSES)[number];

export const intakeAddress = tenantTable(
  'intake_address',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** `u-` + 10 random base32 characters; the part before the `@`. */
    localPart: text('local_part').notNull(),
    domain: text('domain').notNull(),
    status: text('status').$type<IntakeAddressStatus>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    unique('intake_address_local_part_domain_uq').on(t.localPart, t.domain),
    uniqueIndex('intake_address_active_user_uq')
      .on(t.workspaceId, t.userId)
      .where(sql`status = 'active'`),
    foreignKey({
      name: 'intake_address_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('intake_address_status_chk', sql`status in ${inList(INTAKE_ADDRESS_STATUSES)}`),
    check('intake_address_local_part_chk', sql`local_part ~ '^u-[a-z2-7]{10}$'`),
    check('intake_address_revoked_at_chk', sql`(status = 'revoked') = (revoked_at is not null)`),
  ],
);

export const intakeAllowlist = tenantTable(
  'intake_allowlist',
  {
    id: id(),
    /** An exact address (`a@b.c`) or a domain (`b.c`), lower-cased. */
    pattern: text('pattern').notNull(),
    kind: text('kind').$type<IntakeAllowlistKind>().notNull(),
    label: text('label'),
    /** The member who added it; null after the account is deleted (#303). */
    addedBy: uuid('added_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('intake_allowlist_workspace_pattern_uq').on(t.workspaceId, t.pattern),
    foreignKey({
      name: 'intake_allowlist_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('intake_allowlist_kind_chk', sql`kind in ${inList(INTAKE_ALLOWLIST_KINDS)}`),
    check('intake_allowlist_pattern_chk', sql`pattern = lower(pattern) and length(pattern) <= 254`),
  ],
);

export const intakeMessage = tenantTable(
  'intake_message',
  {
    id: id(),
    /** The Message-ID header (or the provider's id); unique per workspace. */
    messageId: text('message_id').notNull(),
    status: text('status').$type<IntakeMessageStatus>().notNull().default('received'),
    /** The raw MIME object's storage key; null once deleted. */
    rawMimeRef: text('raw_mime_ref'),
    /** When the raw MIME may be deleted: received + 30 days; ignored while `pinned`. */
    rawExpiresAt: timestamp('raw_expires_at', { withTimezone: true }).notNull(),
    pinned: boolean('pinned').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('intake_message_workspace_message_id_uq').on(t.workspaceId, t.messageId),
    index('intake_message_workspace_status_received_idx').on(t.workspaceId, t.status, t.receivedAt),
    foreignKey({
      name: 'intake_message_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('intake_message_status_chk', sql`status in ${inList(INTAKE_MESSAGE_STATUSES)}`),
  ],
);
