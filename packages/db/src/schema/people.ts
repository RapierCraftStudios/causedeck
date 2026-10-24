// People of the matter graph (#348, part 5 of #32; #32 data contract, ADR 0013): `person`,
// `organisation` and `role_edge`, tenant tables under FORCE RLS via `tenantTable()`. `person` and
// `role_edge` carry provenance; `organisation` does not (the #32 provenance list names only
// `person` and `role_edge` here). Contact details are kept only for clients and professional
// contacts (PRD §9; no contact-book upload): a CHECK rejects `contact` on any other kind. A role
// edge runs from a person to exactly one target (a person, a matter or a proceeding); its FKs are
// composite and ON DELETE CASCADE, so an edge dies with either end (a SET NULL target would break
// the one-target CHECK). The provenance `anchor_id` is NO ACTION, as on `proceeding`: the erase
// purges role edges and persons before anchors.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, text, unique, uuid } from 'drizzle-orm/pg-core';

import { id, provenance, provenanceCheck, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization } from './auth.ts';
import { anchor } from './documents.ts';
import { personKind, roleEdgeKind } from './enums.ts';
import { matter } from './matter-graph.ts';
import { proceeding } from './proceedings.ts';

/** Contact details of a client or professional contact (PRD §9). */
export interface PersonContact {
  email?: string;
  phone?: string;
  address?: string;
}

export const person = tenantTable(
  'person',
  {
    id: id(),
    name: text('name').notNull(),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    kind: personKind('kind').notNull(),
    /** Only for `client` and `professional` (CHECK `person_contact_chk`). */
    contact: jsonb('contact').$type<PersonContact>(),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('person_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'person_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'person_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('person'),
    check('person_name_chk', sql`btrim(name) <> ''`),
    check('person_contact_chk', sql`contact is null or kind in ('client', 'professional')`),
  ],
);

export const organisation = tenantTable(
  'organisation',
  {
    id: id(),
    name: text('name').notNull(),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t) => [
    unique('organisation_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'organisation_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('organisation_name_chk', sql`btrim(name) <> ''`),
  ],
);

export const roleEdge = tenantTable(
  'role_edge',
  {
    id: id(),
    kind: roleEdgeKind('kind').notNull(),
    fromPersonId: uuid('from_person_id').notNull(),
    /** Exactly one of the three targets is set (CHECK `role_edge_one_target_chk`). */
    toPersonId: uuid('to_person_id'),
    matterId: uuid('matter_id'),
    proceedingId: uuid('proceeding_id'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('role_edge_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('role_edge_workspace_from_idx').on(t.workspaceId, t.fromPersonId),
    index('role_edge_workspace_to_idx').on(t.workspaceId, t.toPersonId),
    index('role_edge_workspace_matter_idx').on(t.workspaceId, t.matterId),
    index('role_edge_workspace_proceeding_idx').on(t.workspaceId, t.proceedingId),
    foreignKey({
      name: 'role_edge_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'role_edge_from_person_fk',
      columns: [t.workspaceId, t.fromPersonId],
      foreignColumns: [person.workspaceId, person.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'role_edge_to_person_fk',
      columns: [t.workspaceId, t.toPersonId],
      foreignColumns: [person.workspaceId, person.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'role_edge_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'role_edge_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'role_edge_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('role_edge'),
    check(
      'role_edge_one_target_chk',
      sql`num_nonnulls(to_person_id, matter_id, proceeding_id) = 1`,
    ),
    check('role_edge_not_self_chk', sql`to_person_id is null or to_person_id <> from_person_id`),
  ],
);
