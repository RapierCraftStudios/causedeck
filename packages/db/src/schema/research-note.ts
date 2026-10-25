// Research notes and per-workspace research providers (#80, D-048). `research_note` is the lawyer's
// own note on a matter with the authorities they chose (`authorities`: label, citation, https url,
// pinned flag; data only, a note never adds a citation to a draft by itself). `research_provider` is
// a provider URL template a lawyer adds for their workspace (SCC Online, Manupatra, ...): https only,
// the host is fixed by the template (`validateProviderTemplate` in core). Both are tenant tables under
// FORCE RLS via `tenantTable()`; neither carries editorial content (D-001 amended).
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, jsonb, text, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization } from './auth.ts';
import { matter } from './matter-graph.ts';

/** One authority the lawyer chose, kept inside `research_note.authorities`. */
export interface ResearchAuthority {
  label: string;
  citation?: string | undefined;
  url?: string | undefined;
  pinned: boolean;
}

export const researchNote = tenantTable(
  'research_note',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    authorities: jsonb('authorities').$type<ResearchAuthority[]>().notNull().default([]),
    /** The user who wrote the note (a user id, not a member row, so it survives a role change). */
    createdBy: uuid('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('research_note_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'research_note_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'research_note_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    check('research_note_title_chk', sql`title <> ''`),
    check('research_note_authorities_chk', sql`jsonb_typeof(authorities) = 'array'`),
  ],
);

export const researchProvider = tenantTable(
  'research_provider',
  {
    id: id(),
    /** Stable slug within the workspace, e.g. `scc-online`; unique per workspace. */
    key: text('key').notNull(),
    label: text('label').notNull(),
    /** `https://` URL with a `{q}` placeholder for the encoded query. */
    urlTemplate: text('url_template').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique('research_provider_workspace_key_uq').on(t.workspaceId, t.key),
    foreignKey({
      name: 'research_provider_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('research_provider_key_chk', sql`key ~ '^[a-z][a-z0-9-]{0,39}$'`),
    check('research_provider_template_chk', sql`url_template like 'https://%'`),
  ],
);
