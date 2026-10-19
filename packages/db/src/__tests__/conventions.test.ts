import { fileURLToPath } from 'node:url';

import { foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { id, workspaceId, workspaceIndex } from '../columns.ts';
import {
  checkSchemaConventions,
  GLOBAL_TABLES,
  NULLABLE_WORKSPACE_TABLES,
  tablesOf,
} from '../conventions.ts';
import * as schema from '../schema/index.ts';
import { runCli } from './run-cli.ts';

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

const workspace = pgTable('workspace', { id: id(), name: text('name').notNull() });

const matter = pgTable(
  'matter',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspace.id),
    title: text('title').notNull(),
  },
  (t) => [
    workspaceIndex('matter', t.workspaceId),
    unique('matter_ws_id_uq').on(t.workspaceId, t.id),
  ],
);

const globals = [...GLOBAL_TABLES, 'workspace'];
const rules = (tables: Parameters<typeof checkSchemaConventions>[0]) =>
  checkSchemaConventions(tables, { globalTables: globals }).map((v) => `${v.table}:${v.rule}`);

describe('checkSchemaConventions', () => {
  it('passes the committed schema', () => {
    expect(checkSchemaConventions(tablesOf(schema))).toEqual([]);
  });

  it('passes a tenant table with a workspace index and an FK to a global table', () => {
    expect(rules([workspace, matter])).toEqual([]);
  });

  it('fails a tenant table without an index led by workspace_id', () => {
    const noIndex = pgTable('no_index', { id: id(), workspaceId: workspaceId() });
    const trailing = pgTable(
      'trailing',
      { id: id(), workspaceId: workspaceId(), body: text('body') },
      (t) => [index('trailing_body_ws_idx').on(t.body, t.workspaceId)],
    );
    expect(rules([noIndex, trailing])).toEqual([
      'no_index:workspace-index',
      'trailing:workspace-index',
    ]);
  });

  it('fails a nullable workspace_id', () => {
    const nullable = pgTable(
      'nullable_ws',
      { id: id(), workspaceId: uuid('workspace_id') },
      (t) => [index('nullable_ws_idx').on(t.workspaceId)],
    );
    expect(rules([nullable])).toEqual(['nullable_ws:workspace-not-null']);
  });

  it('allows a nullable workspace_id only on listed tables, which still need the index', () => {
    const nullable = pgTable(
      'nullable_ws',
      { id: id(), workspaceId: uuid('workspace_id') },
      (t) => [index('nullable_ws_idx').on(t.workspaceId)],
    );
    const unindexed = pgTable('nullable_unindexed', {
      id: id(),
      workspaceId: uuid('workspace_id'),
    });
    const check = (tables: Parameters<typeof checkSchemaConventions>[0]) =>
      checkSchemaConventions(tables, {
        globalTables: globals,
        nullableWorkspaceTables: ['nullable_ws', 'nullable_unindexed'],
      }).map((v) => `${v.table}:${v.rule}`);
    expect(check([nullable])).toEqual([]);
    expect(check([unindexed])).toEqual(['nullable_unindexed:workspace-index']);
    expect(NULLABLE_WORKSPACE_TABLES).toEqual(['audit_event']);
  });

  it('fails a single-column FK from a tenant table to another tenant table', () => {
    const hearing = pgTable(
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
    expect(rules([matter, hearing])).toEqual(['hearing:cross-workspace-fk']);
  });

  it('fails a composite FK that does not pair workspace_id with workspace_id', () => {
    const other = pgTable(
      'other',
      {
        id: id(),
        workspaceId: workspaceId(),
        matterId: uuid('matter_id').notNull(),
        title: text('title'),
      },
      (t) => [
        workspaceIndex('other', t.workspaceId),
        foreignKey({ columns: [t.matterId, t.title], foreignColumns: [matter.id, matter.title] }),
      ],
    );
    expect(rules([matter, other])).toEqual(['other:cross-workspace-fk']);
  });

  it('passes a composite FK that includes workspace_id on both sides', () => {
    const hearing = pgTable(
      'hearing',
      { id: id(), workspaceId: workspaceId(), matterId: uuid('matter_id').notNull() },
      (t) => [
        workspaceIndex('hearing', t.workspaceId),
        foreignKey({
          columns: [t.workspaceId, t.matterId],
          foreignColumns: [matter.workspaceId, matter.id],
        }),
      ],
    );
    expect(rules([matter, hearing])).toEqual([]);
  });

  it('reads columns declared by key only (snake_case casing)', () => {
    const keyed = pgTable('keyed', { id: id(), workspaceId: uuid().notNull() });
    expect(rules([keyed])).toEqual(['keyed:workspace-index']);
  });

  it('exempts GLOBAL_TABLES', () => {
    const lookup = pgTable('lookup', { id: id(), workspaceId: uuid('workspace_id') });
    expect(checkSchemaConventions([lookup], { globalTables: ['lookup'] })).toEqual([]);
    expect(GLOBAL_TABLES).toContain('schema_info');
  });
});

describe('db:check CLI', () => {
  it('passes on the committed schema and migrations', async () => {
    const run = await runCli(
      'pnpm',
      ['exec', 'tsx', 'scripts/check-schema-conventions.ts'],
      PACKAGE_DIR,
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('table(s) OK');
  });

  it('exits 1 and names each violation for a schema that breaks the conventions', async () => {
    const run = await runCli(
      'pnpm',
      [
        'exec',
        'tsx',
        'scripts/check-schema-conventions.ts',
        '--schema',
        'src/__tests__/fixtures/bad-schema.ts',
      ],
      PACKAGE_DIR,
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('[workspace-index] matter needs an index');
    expect(run.stderr).toContain('[cross-workspace-fk] hearing(matter_id) -> matter');
  });
});
