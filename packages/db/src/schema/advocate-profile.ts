// The importing advocate's own identifiers (#57 part 4, #550): Bar enrolment numbers and name
// aliases, kept per member so the matched-only rule of the bootstrap import reads the identifiers of
// the person who drops the files, not of the chamber. Saved only after the member confirmed them.
// Tenant table under FORCE RLS via `tenantTable()`; composite FKs keep the row inside its workspace.
import { sql } from 'drizzle-orm';
import { check, foreignKey, text, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

export const advocateProfile = tenantTable(
  'advocate_profile',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Upper-case enrolment numbers / BRNs as `getAdvocateIdentifiers` normalises them. */
    enrolmentNumbers: text('enrolment_numbers')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t) => [
    unique('advocate_profile_workspace_user_uq').on(t.workspaceId, t.userId),
    foreignKey({
      name: 'advocate_profile_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check(
      'advocate_profile_size_chk',
      sql`cardinality(enrolment_numbers) <= 20 and cardinality(aliases) <= 50`,
    ),
  ],
);
