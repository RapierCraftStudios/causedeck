// Integration tokens (#287, part of #25): the private email intake address
// (`intake+<token>@<domain>`) and the private ICS feed URL shown on the settings integrations page.
// One row per (workspace, kind). Only the sha256 hex of the token is stored (`token_hash`, unique
// across workspaces so the Capture milestone can resolve a token by its hash); the token itself is
// shown once when it is created or rotated. Rotating replaces the hash, so the old token stops
// working at once. A tenant table under FORCE RLS via `tenantTable()`.
//
// The intake and feed behaviour (inbound email, `/api/ics/[token]`) is the Capture milestone
// (#54, #53); this table only holds the tokens.
import { sql } from 'drizzle-orm';
import { check, foreignKey, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization } from './auth.ts';

export const INTEGRATION_KINDS = ['email_intake', 'ics_feed'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const workspaceIntegration = tenantTable(
  'workspace_integration',
  {
    id: id(),
    kind: text('kind').$type<IntegrationKind>().notNull(),
    /** sha256 hex of the token; the token is never stored. */
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** When the token was last replaced; null until the first rotation. */
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (t) => [
    unique('workspace_integration_workspace_kind_uq').on(t.workspaceId, t.kind),
    unique('workspace_integration_token_hash_uq').on(t.tokenHash),
    check('workspace_integration_kind_chk', sql`kind in ${inList(INTEGRATION_KINDS)}`),
    foreignKey({
      name: 'workspace_integration_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
  ],
);
