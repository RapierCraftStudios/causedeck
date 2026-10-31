// Client contacts (#82, part 1): `client_contact` holds the reachable details of an existing client
// (a `person` of kind client): a phone in E.164, an email and the language to write in, one row per
// person and kind. `archived_at` hides a contact; `purge_requested` flags it for the DPDP erasure
// sweep (the details are cleared by that sweep, not here). A tenant table under FORCE RLS. There is
// no prospect or lead state: a contact only exists for a client that already has a person row.
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';
import { person } from './people.ts';

/** Mirrors `CONTACT_KINDS` and `LANGUAGE_PREFS` in `@causedeck/validators/client-contact` (CHECKs). */
export const CLIENT_CONTACT_KINDS = ['primary', 'instructing', 'accounts', 'family'] as const;
export const CLIENT_CONTACT_LANGUAGES = ['en', 'hi', 'ta', 'kn', 'te', 'ml', 'mr'] as const;

export const clientContact = tenantTable(
  'client_contact',
  {
    id: id(),
    personId: uuid('person_id').notNull(),
    kind: text('kind').notNull().default('primary'),
    /** E.164, e.g. `+919876543210`. */
    phone: text('phone'),
    email: text('email'),
    languagePref: text('language_pref').notNull().default('en'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** Set with `archived_at` when the contact is to be erased by the DPDP sweep. */
    purgeRequested: boolean('purge_requested').notNull().default(false),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('client_contact_workspace_person_kind_uq').on(t.workspaceId, t.personId, t.kind),
    unique('client_contact_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'client_contact_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'client_contact_person_fk',
      columns: [t.workspaceId, t.personId],
      foreignColumns: [person.workspaceId, person.id],
    }).onDelete('cascade'),
    check('client_contact_kind_chk', sql`kind in ${inList(CLIENT_CONTACT_KINDS)}`),
    check('client_contact_language_chk', sql`language_pref in ${inList(CLIENT_CONTACT_LANGUAGES)}`),
    check('client_contact_phone_chk', sql`phone is null or phone ~ '^[+][1-9][0-9]{6,14}$'`),
    check('client_contact_purge_chk', sql`not purge_requested or archived_at is not null`),
  ],
);
