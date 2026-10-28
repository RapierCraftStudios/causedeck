// Client status links (#88, ADR 0049): `status_link` is an advocate-authored, expiring, revocable
// link for one existing client contact. It stores only the authored fields (`payload`) and the
// sha-256 of the token, never the token. `status_link_access` is one row per view: the time and a
// coarse user-agent class; no IP is stored. Tenant tables under FORCE RLS via `tenantTable()`; the
// signed-out read is the narrow `app_status_link_view()` function. There is no send path.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';
import { clientContact } from './client-contact.ts';
import { matter } from './matter-graph.ts';

/** Mirror `STATUS_LINK_LANGUAGES` in `@causedeck/validators/status-link` (CHECK). */
export const STATUS_LINK_LANGUAGES = ['en', 'ta', 'kn'] as const;
export type StatusLinkLanguageValue = (typeof STATUS_LINK_LANGUAGES)[number];
export const STATUS_LINK_UA_CLASSES = ['mobile', 'desktop', 'bot', 'other'] as const;
export type StatusLinkUaClass = (typeof STATUS_LINK_UA_CLASSES)[number];

/** The authored fields and nothing else. An erased payload is `{}`. */
export interface StatusLinkPayloadJson {
  headline?: string;
  note?: string;
  nextDate?: string | null;
}

export const statusLink = tenantTable(
  'status_link',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    clientContactId: uuid('client_contact_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    payload: jsonb('payload').$type<StatusLinkPayloadJson>().notNull(),
    language: text('language').$type<StatusLinkLanguageValue>().notNull().default('en'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Set when the retention job cleared the payload of a long-expired link. */
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('status_link_token_hash_uq').on(t.tokenHash),
    unique('status_link_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'status_link_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'status_link_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'status_link_client_contact_fk',
      columns: [t.workspaceId, t.clientContactId],
      foreignColumns: [clientContact.workspaceId, clientContact.id],
    }).onDelete('cascade'),
    index('status_link_matter_idx').on(t.workspaceId, t.matterId),
    check('status_link_payload_chk', sql`jsonb_typeof(${t.payload}) = 'object'`),
    check('status_link_language_chk', sql`language in ${inList(STATUS_LINK_LANGUAGES)}`),
  ],
);

export const statusLinkAccess = tenantTable(
  'status_link_access',
  {
    id: id(),
    linkId: uuid('link_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    uaClass: text('ua_class').$type<StatusLinkUaClass>().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'status_link_access_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'status_link_access_link_fk',
      columns: [t.workspaceId, t.linkId],
      foreignColumns: [statusLink.workspaceId, statusLink.id],
    }).onDelete('cascade'),
    index('status_link_access_link_idx').on(t.workspaceId, t.linkId),
    check('status_link_access_ua_chk', sql`ua_class in ${inList(STATUS_LINK_UA_CLASSES)}`),
  ],
);
