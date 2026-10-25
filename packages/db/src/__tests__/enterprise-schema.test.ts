// Enterprise onboarding data model (#682): shape of the five tenant tables.
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  migrationRun,
  migrationRunRow,
  provisioningRun,
  scimToken,
  ssoProvider,
} from '../schema/enterprise.ts';

const cfg = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t);
const TABLES = [ssoProvider, scimToken, provisioningRun, migrationRun, migrationRunRow];

describe('enterprise schema (#682)', () => {
  it('declares workspace-scoped tables with a workspace_id column', () => {
    expect(TABLES.map((t) => cfg(t).name)).toEqual([
      'sso_provider',
      'scim_token',
      'provisioning_run',
      'migration_run',
      'migration_run_row',
    ]);
    for (const t of TABLES) expect(t.workspaceId.notNull).toBe(true);
  });

  it('limits the SSO protocol and requires a lower-case domain', () => {
    expect(cfg(ssoProvider).checks.map((c) => c.name)).toEqual([
      'sso_provider_protocol_chk',
      'sso_provider_domain_chk',
      'sso_provider_issuer_chk',
    ]);
    expect(cfg(ssoProvider).indexes.map((i) => i.config.name)).toContain('sso_provider_domain_uq');
  });

  it('stores only a unique hash of a SCIM token', () => {
    expect(scimToken.tokenHash.notNull).toBe(true);
    expect(Object.keys(scimToken)).not.toContain('token');
    expect(cfg(scimToken).indexes.map((i) => i.config.name)).toContain('scim_token_token_hash_uq');
  });

  it('keeps run rows inside their run and workspace, one row per index', () => {
    const fks = cfg(migrationRunRow).foreignKeys.map((f) => f.getName());
    expect(fks).toContain('migration_run_row_run_fk');
    expect(cfg(migrationRunRow).uniqueConstraints.map((u) => u.name)).toContain(
      'migration_run_row_run_index_uq',
    );
    expect(cfg(migrationRunRow).checks.map((c) => c.name)).toContain('migration_run_row_state_chk');
  });
});
