// In-app help state (#94): `help_state` records what one member has dismissed in one workspace
// (first-run coachmarks today), keyed by a short string. A row exists only once dismissed.
// Tenant table under FORCE RLS via `tenantTable()`.
import { check, foreignKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

export const HELP_STATE_KEY_PATTERN = '^[a-z][a-z0-9_.-]{0,63}$';

export const helpState = tenantTable(
  'help_state',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'help_state_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    unique('help_state_workspace_user_key_uq').on(t.workspaceId, t.userId, t.key),
    check('help_state_key_chk', sql`key ~ '^[a-z][a-z0-9_.-]{0,63}$'`),
  ],
);
