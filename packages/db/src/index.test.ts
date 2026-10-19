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
      'withWorkspace',
      'withUser',
      'TenancyError',
      'tenantTable',
      'tenantPolicy',
    ]) {
      expect(root, name).toHaveProperty(name);
    }
  });

  it('never exports the owner-role client or the migrator', () => {
    for (const name of ['ownerDb', 'createOwnerDb', 'runMigrations']) {
      expect(Object.keys(root)).not.toContain(name);
    }
  });

  it('creates the platform tables, the Better Auth tables (#151), the workspace tables (#177), the billing tables (#200), the usage tables (#218), the audit tables (#226) and the storage key table (#216)', () => {
    expect(
      root
        .tablesOf(root.schema)
        .map((t) => getTableName(t))
        .sort(),
    ).toEqual([
      'account',
      'ai_call',
      'api_idempotency_key',
      'audit_event',
      'billing_event',
      'budget_override',
      'entitlement',
      'invitation',
      'job_effect',
      'member',
      'organization',
      'passkey',
      'plan',
      'rate_limit',
      'schema_info',
      'session',
      'subscription',
      'two_factor',
      'usage_counter',
      'usage_event',
      'usage_period_summary',
      'usage_reservation',
      'user',
      'verification',
      'workspace_key',
      'workspace_settings',
      'workspace_slug_history',
    ]);
  });

  it('surfaces the Better Auth organization as `workspace`', () => {
    expect(root).toHaveProperty('workspace');
    expect(root.workspace).toBe(root.schema.organization);
    expect(getTableName(root.workspace)).toBe('organization');
  });
});
