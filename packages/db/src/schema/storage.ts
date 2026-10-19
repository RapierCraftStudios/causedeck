// Storage tables (#21 part 2, #216; spike §6, architecture §6.3). `workspace_key` holds each
// workspace's data-encryption key (DEK), wrapped by the key-encryption key (KEK) named in `kek_id`
// (AES-256-GCM, AAD = workspace id) by `@causedeck/storage`. Crypto-erase zeroes `wrapped_dek` and
// sets `destroyed_at`; the row stays so a destroyed key is never silently re-created. See
// docs/engineering/storage.md.
import { sql } from 'drizzle-orm';
import { check, customType, foreignKey, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization } from './auth.ts';

/** A Postgres `bytea` column mapped to a Node `Buffer`. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const workspaceKey = tenantTable(
  'workspace_key',
  {
    wrappedDek: bytea('wrapped_dek').notNull(),
    kekId: text('kek_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    destroyedAt: timestamp('destroyed_at', { withTimezone: true }),
  },
  (t) => [
    // Table-level so the convention checker sees `workspace_id` leading the primary key.
    primaryKey({ name: 'workspace_key_pkey', columns: [t.workspaceId] }),
    foreignKey({
      name: 'workspace_key_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    // A destroyed key keeps no key material: every byte of the wrapped DEK is zero.
    check(
      'workspace_key_destroyed_zeroed_chk',
      sql`${t.destroyedAt} is null or ltrim(encode(${t.wrappedDek}, 'hex'), '0') = ''`,
    ),
  ],
);
