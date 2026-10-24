import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { checkSchemaConventions, GLOBAL_TABLES, tablesOf } from '../conventions.ts';
import { workspace } from '../index.ts';
import { LOCALES, MEMBER_STATUSES, WORKSPACE_KINDS, WORKSPACE_ROLES } from '../schema/auth.ts';
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

const checksOf = (table: Parameters<typeof getTableConfig>[0]) =>
  Object.fromEntries(getTableConfig(table).checks.map((c) => [c.name, c.value]));

describe('workspace data model (#177)', () => {
  it('extends organization in place with kind, plan, creator and soft delete', () => {
    const { organization } = schema;
    expect(WORKSPACE_KINDS).toEqual(['solo', 'chamber', 'institution']);
    expect(organization.slug.getSQLType()).toBe('citext');
    expect(organization.kind.notNull && organization.kind.default).toBe('solo');
    expect(organization.planId.notNull).toBe(false);
    expect(organization.createdBy.notNull).toBe(false);
    expect(organization.deletedAt.notNull).toBe(false);
    expect(Object.keys(checksOf(organization))).toEqual(['organization_kind_chk']);
    const [creator] = getTableConfig(organization).foreignKeys;
    expect(creator && getTableName(creator.reference().foreignTable)).toBe('user');
    expect(creator?.onDelete).toBe('set null');
  });

  it('adds member status and joined_at, and invitation token hash and lifecycle stamps', () => {
    const { member, invitation } = schema;
    expect(MEMBER_STATUSES).toEqual(['active', 'suspended', 'removed']);
    expect(member.status.default).toBe('active');
    expect(member.joinedAt.notNull && member.joinedAt.hasDefault).toBe(true);
    expect(Object.keys(checksOf(member))).toContain('member_status_chk');
    for (const column of [invitation.tokenHash, invitation.acceptedAt, invitation.revokedAt]) {
      expect(column.notNull, column.name).toBe(false);
    }
    expect(getTableConfig(invitation).indexes.map((i) => i.config.name)).toContain(
      'invitation_token_hash_uq',
    );
  });

  it('keeps every added Better Auth column nullable or defaulted', () => {
    const added = {
      organization: ['kind', 'plan_id', 'created_by', 'deleted_at'],
      member: ['status', 'joined_at'],
      invitation: ['token_hash', 'accepted_at', 'revoked_at'],
    };
    for (const table of [schema.organization, schema.member, schema.invitation]) {
      const config = getTableConfig(table);
      for (const column of config.columns.filter((c) =>
        added[config.name as keyof typeof added].includes(c.name),
      )) {
        expect(!column.notNull || column.hasDefault, `${config.name}.${column.name}`).toBe(true);
      }
    }
  });

  it('adds workspace_settings and workspace_slug_history as convention-passing tenant tables', () => {
    const { workspaceSettings, workspaceSlugHistory } = schema;
    expect(getTableName(workspaceSettings)).toBe('workspace_settings');
    expect(workspaceSettings.indiaOnlyAi.default).toBe(true);
    expect(workspaceSettings.timezone.default).toBe('Asia/Kolkata');
    expect(workspaceSettings.retention.getSQLType()).toBe('jsonb');
    expect(getTableConfig(workspaceSettings).primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      'workspace_id',
    ]);
    expect(workspaceSlugHistory.slug.getSQLType()).toBe('citext');
    expect(workspaceSlugHistory.expiresAt.notNull).toBe(true);
    for (const table of [workspaceSettings, workspaceSlugHistory]) {
      expect(GLOBAL_TABLES).not.toContain(getTableName(table));
      expect(checkSchemaConventions([table], { globalTables: [] })).toEqual([]);
    }
  });
});
