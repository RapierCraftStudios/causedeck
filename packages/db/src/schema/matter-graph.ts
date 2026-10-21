// The matter graph (#345, part 2 of #32; #32 data contract, ADR 0013): `matter`, the root every
// proceeding, document and restriction hangs off. A tenant table under FORCE RLS via `tenantTable()`.
// Children reference it with composite `(workspace_id, matter_id)` keys, so `matter` carries a unique
// `(workspace_id, id)`. `sensitive` is data only here (CA-10: no AI processing, no bulk import, no
// outward brief); the gateway and capture issues (#44, #43) enforce it.
//
// `owner_member_id` and `merged_into_matter_id` are nullable composite FKs whose parent can go away
// (an account deletion cascades its member rows; an erase deletes matters in 500-row batches). They
// are `ON DELETE SET NULL (<column>)` in migration 0038 (Postgres 15+): a plain composite SET NULL
// would also null `workspace_id`. Drizzle records them as `set null`.
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, member, organization } from './auth.ts';

export const MATTER_STATUSES = ['active', 'disposed', 'archived'] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

export const matter = tenantTable(
  'matter',
  {
    id: id(),
    title: text('title').notNull(),
    practiceArea: text('practice_area'),
    status: text('status').$type<MatterStatus>().notNull().default('active'),
    sensitive: boolean('sensitive').notNull().default(false),
    /** Null once the owner's membership is gone (account deletion). */
    ownerMemberId: uuid('owner_member_id'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    /** Memory-backed in a later issue. */
    synopsis: text('synopsis'),
    mergedIntoMatterId: uuid('merged_into_matter_id'),
    ...timestamps(),
  },
  (t) => [
    // The target of the composite `(workspace_id, matter_id)` FKs.
    unique('matter_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'matter_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'matter_owner_member_fk',
      columns: [t.workspaceId, t.ownerMemberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'matter_merged_into_fk',
      columns: [t.workspaceId, t.mergedIntoMatterId],
      foreignColumns: [t.workspaceId, t.id],
    }).onDelete('set null'),
    check('matter_status_chk', sql`status in ${inList(MATTER_STATUSES)}`),
    check(
      'matter_not_merged_into_self_chk',
      sql`merged_into_matter_id is null or merged_into_matter_id <> id`,
    ),
  ],
);
