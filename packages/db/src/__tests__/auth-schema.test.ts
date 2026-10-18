import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { checkSchemaConventions, GLOBAL_TABLES, tablesOf } from '../conventions.ts';
import { workspace } from '../index.ts';
import { LOCALES, WORKSPACE_ROLES } from '../schema/auth.ts';
import * as schema from '../schema/index.ts';

const GLOBAL_AUTH_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'passkey',
  'two_factor',
  'rate_limit',
];
const TENANT_ROOTS = ['organization', 'member', 'invitation'];
const AUTH_TABLES = [...GLOBAL_AUTH_TABLES, ...TENANT_ROOTS];

const authTables = tablesOf(schema).filter((t) => AUTH_TABLES.includes(getTableName(t)));

describe('Better Auth schema (#151)', () => {
  it('defines every Better Auth table', () => {
    expect(authTables.map((t) => getTableName(t)).sort()).toEqual([...AUTH_TABLES].sort());
  });

  it('uses uuid primary keys with a database default and uuid foreign keys', () => {
    for (const table of authTables) {
      const config = getTableConfig(table);
      const pk = config.columns.find((c) => c.name === 'id');
      expect(pk?.getSQLType(), config.name).toBe('uuid');
      expect(pk?.primary, config.name).toBe(true);
      expect(pk?.hasDefault, config.name).toBe(true);
      for (const fk of config.foreignKeys) {
        for (const column of fk.reference().columns) {
          expect(column.getSQLType(), `${config.name}.${column.name}`).toBe('uuid');
        }
      }
    }
  });

  it('names every column in snake_case', () => {
    for (const table of authTables) {
      for (const column of getTableConfig(table).columns) {
        expect(column.name, getTableConfig(table).name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it('stores the organization FK of member and invitation as a NOT NULL workspace_id', () => {
    for (const table of [schema.member, schema.invitation]) {
      expect(table.organizationId.name).toBe('workspace_id');
      expect(table.organizationId.notNull).toBe(true);
      const [fk] = getTableConfig(table).foreignKeys.filter(
        (f) => f.reference().columns[0]?.name === 'workspace_id',
      );
      expect(getTableName(fk?.reference().foreignTable ?? table)).toBe('organization');
    }
  });

  it('lists the global auth tables in GLOBAL_TABLES and keeps the tenant roots out', () => {
    expect(GLOBAL_TABLES).toEqual(expect.arrayContaining(GLOBAL_AUTH_TABLES));
    for (const name of TENANT_ROOTS) expect(GLOBAL_TABLES).not.toContain(name);
  });

  it('passes the schema conventions, with member and invitation checked as tenant tables', () => {
    expect(checkSchemaConventions(tablesOf(schema))).toEqual([]);
    // Not exempt: member is checked as a tenant table and still satisfies every rule.
    expect(
      checkSchemaConventions([schema.member], { globalTables: [] }).map((v) => v.rule),
    ).toEqual([]);
  });

  it('exports organization as the typed `workspace` alias', () => {
    expect(workspace).toBe(schema.organization);
  });

  it('mirrors the workspace roles and locales', () => {
    expect(WORKSPACE_ROLES).toEqual(['owner', 'advocate', 'junior', 'clerk', 'viewer']);
    expect(LOCALES).toEqual(['en', 'ta', 'kn']);
    expect(schema.member.role.hasDefault).toBe(false);
  });
});
