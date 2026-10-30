// Status incident tables (#769): platform tables that hold public status text and no tenant data.
// No database: this checks the schema definition and the conventions.
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { checkSchemaConventions, GLOBAL_TABLES } from '../conventions.ts';
import { incident, incidentUpdate } from '../schema/status.ts';

const TABLES = [incident, incidentUpdate];

describe('incident tables', () => {
  it('are global tables that pass the schema conventions', () => {
    for (const table of TABLES) expect(GLOBAL_TABLES).toContain(getTableConfig(table).name);
    expect(checkSchemaConventions(TABLES)).toEqual([]);
  });

  it('hold no tenant data: no workspace_id and no foreign key outside the incident log', () => {
    for (const table of TABLES) {
      const config = getTableConfig(table);
      const columns = config.columns.map((c) => c.name);
      expect(columns, config.name).not.toContain('workspace_id');
      for (const fk of config.foreignKeys) {
        expect(getTableConfig(fk.reference().foreignTable).name).toBe('incident');
      }
    }
  });

  it('keep person and matter references out of the public columns', () => {
    const columns = TABLES.flatMap((t) => getTableConfig(t).columns.map((c) => c.name));
    for (const name of columns) expect(name).not.toMatch(/matter|document|client|email|phone/);
  });
});
