// Per-matter restrictions (#233, part of #20; spike §4.1, architecture §6.3). A restricted matter
// is readable only by the users in `allowed_user_ids` plus owners (unless the workspace turns
// `ownersSeeRestrictedMatters` off); `@causedeck/auth` `can()` and `matterVisibilityPredicate()` (`@causedeck/auth/policy/visibility`)
// enforce it, `@causedeck/core` `restrictMatter()` writes it. A tenant table under FORCE RLS via
// `tenantTable()`, one row per (workspace, matter).
//
// `matter_id` references the matter through the composite `(workspace_id, matter_id)` FK, ON DELETE
// CASCADE (#345, migration 0038, which created `matter`): deleting a matter removes its restriction.
import { sql } from 'drizzle-orm';
import { foreignKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';
import { matter } from './matter-graph.ts';

export const matterRestriction = tenantTable(
  'matter_restriction',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    allowedUserIds: uuid('allowed_user_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    reason: text('reason'),
    // Null once the creator's account is deleted (#303).
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('matter_restriction_workspace_matter_uq').on(t.workspaceId, t.matterId),
    foreignKey({
      name: 'matter_restriction_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'matter_restriction_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
  ],
);
