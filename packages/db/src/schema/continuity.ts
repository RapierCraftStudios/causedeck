// Continuity (#71): `matter_view` marks when a member last opened a matter (what-changed reads it) and
// `handover_note` stores each saved handover as an immutable version (the migration's trigger rejects
// any update but the recipient's acknowledgement). Both are tenant tables under FORCE RLS. The notes
// are internal to the workspace; the derived content is stored as the author saw it.
import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, jsonb, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { member, organization } from './auth.ts';
import { matter } from './matter-graph.ts';

export const matterView = tenantTable(
  'matter_view',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    memberId: uuid('member_id').notNull(),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('matter_view_workspace_matter_member_uq').on(t.workspaceId, t.matterId, t.memberId),
    foreignKey({
      name: 'matter_view_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'matter_view_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'matter_view_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('cascade'),
  ],
);

export const handoverNote = tenantTable(
  'handover_note',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    /** Null once the author's membership is gone. */
    authorId: uuid('author_id'),
    /** The member the note is addressed to; null once their membership is gone. */
    recipientId: uuid('recipient_id'),
    body: jsonb('body').notNull(),
    version: integer('version').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('handover_note_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('handover_note_workspace_matter_version_uq').on(t.workspaceId, t.matterId, t.version),
    foreignKey({
      name: 'handover_note_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'handover_note_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'handover_note_author_fk',
      columns: [t.workspaceId, t.authorId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'handover_note_recipient_fk',
      columns: [t.workspaceId, t.recipientId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('set null'),
    check('handover_note_version_chk', sql`version >= 1`),
    check('handover_note_body_chk', sql`jsonb_typeof(body) = 'object'`),
  ],
);
