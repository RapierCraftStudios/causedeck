// A schema that breaks both tenancy conventions, for the `db:check` CLI test.
import { pgTable, uuid } from 'drizzle-orm/pg-core';

import { id, workspaceId, workspaceIndex } from '../../columns.ts';

export const matter = pgTable('matter', { id: id(), workspaceId: workspaceId() });

export const hearing = pgTable(
  'hearing',
  {
    id: id(),
    workspaceId: workspaceId(),
    matterId: uuid('matter_id')
      .notNull()
      .references(() => matter.id),
  },
  (t) => [workspaceIndex('hearing', t.workspaceId)],
);
