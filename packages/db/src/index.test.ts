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
      'globalOrWorkspaceTable',
      'globalOrWorkspacePolicy',
      'GLOBAL_OR_WORKSPACE_TABLES',
    ]) {
      expect(root, name).toHaveProperty(name);
    }
  });

  it('never exports the owner-role client or the migrator', () => {
    for (const name of ['ownerDb', 'createOwnerDb', 'runMigrations']) {
      expect(Object.keys(root)).not.toContain(name);
    }
  });

  it('creates the platform tables, the Better Auth tables (#151), the workspace tables (#177), the billing tables (#200), the audit tables (#226), the notification tables (#194) the usage tables (#218), the flag tables (#22), the SaaS invoice tables (#252) and the upload table (#217), and the matter restriction table (#233), the lifecycle tables (#301), the staff support tables (#308), the legal-hold invoice table (#302), the court reference tables (#344) the matter and document tables (#345), the proceeding tables (#346), the docket tables (#347) and the people tables (#348)', () => {
    expect(
      root
        .tablesOf(root.schema)
        .map((t) => getTableName(t))
        .sort(),
    ).toEqual([
      'access_mode_registry',
      'account',
      'ai_call',
      'anchor',
      'api_idempotency_key',
      'appearance',
      'audit_actor_salt',
      'audit_event',
      'bench',
      'billing_event',
      'blob',
      'budget_override',
      'court_hall',
      'deletion_job',
      'deletion_tombstone',
      'document',
      'document_page',
      'email_suppression',
      'entitlement',
      'export_job',
      'feature_flag',
      'flag_change_request',
      'forum',
      'hearing',
      'invitation',
      'invoice_counter',
      'job_effect',
      'legal_hold_invoice',
      'listing',
      'matter',
      'matter_restriction',
      'member',
      'notification',
      'notification_pref',
      'notification_setting',
      'obligation',
      'order',
      'organisation',
      'organization',
      'passkey',
      'person',
      'plan',
      'proceeding',
      'proceeding_link',
      'proceeding_state_change',
      'push_subscription',
      'rate_limit',
      'role_edge',
      'saas_invoice',
      'saas_invoice_line',
      'schema_info',
      'session',
      'staff_user',
      'subscription',
      'support_session',
      'task',
      'two_factor',
      'usage_counter',
      'usage_event',
      'usage_period_summary',
      'usage_reservation',
      'user',
      'verification',
      'workspace_feature_flag',
      'workspace_integration',
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
