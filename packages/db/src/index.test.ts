import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as root from './index.ts';

describe('@causedeck/db root entry point', () => {
  it('exports the client, column helpers, conventions and vector helpers', () => {
    for (const name of [
      'createDb',
      'db',
      'id',
      'timestamps',
      'workspaceId',
      'workspaceIndex',
      'provenance',
      'provenanceCheck',
      'checkSchemaConventions',
      'GLOBAL_TABLES',
      'EMBEDDING_DIMENSIONS',
      'schema',
    ]) {
      expect(root, name).toHaveProperty(name);
    }
  });

  it('never exports the owner-role client or the migrator', () => {
    for (const name of ['ownerDb', 'createOwnerDb', 'runMigrations']) {
      expect(Object.keys(root)).not.toContain(name);
    }
  });

  it('creates no domain table: only the schema_info baseline', () => {
    expect(root.tablesOf(root.schema).map((t) => getTableName(t))).toEqual(['schema_info']);
  });
});
