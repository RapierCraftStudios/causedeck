// Enterprise onboarding data model (#682, part 1 of #508): `sso_provider` is an organisation's
// SAML or OIDC identity provider, `scim_token` a hashed bearer token for SCIM provisioning,
// `provisioning_run` one bulk seat provisioning (CSV or SCIM) and `migration_run` one dry-run or
// real bulk matter import with `migration_run_row` holding the per-row state that makes a run
// resumable and reversible. "Organisation" is the workspace. Tenant tables under FORCE RLS via
// `tenantTable()`; composite FKs keep every row inside its workspace. Schema only: the SSO sign-in
// lookup by domain (before a workspace is known) belongs to the sibling that builds SSO.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgView,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';

export const SSO_PROTOCOLS = ['saml', 'oidc'] as const;
export type SsoProtocol = (typeof SSO_PROTOCOLS)[number];

export const PROVISIONING_SOURCES = ['csv', 'scim'] as const;
export type ProvisioningSource = (typeof PROVISIONING_SOURCES)[number];

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'rolled_back'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const MIGRATION_MODES = ['dry_run', 'import'] as const;
export type MigrationMode = (typeof MIGRATION_MODES)[number];

export const MIGRATION_ROW_STATES = ['pending', 'ok', 'skipped', 'error', 'rolled_back'] as const;
export type MigrationRowState = (typeof MIGRATION_ROW_STATES)[number];

export const ssoProvider = tenantTable(
  'sso_provider',
  {
    id: id(),
    protocol: text('protocol').notNull().$type<SsoProtocol>(),
    issuer: text('issuer').notNull(),
    /** The email domain that signs in through this provider, lower case. */
    domain: text('domain').notNull(),
    /** Protocol settings (endpoints, certificate, client id and secret); a secret, never exported. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(false),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'sso_provider_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    uniqueIndex('sso_provider_domain_uq').on(t.domain),
    check('sso_provider_protocol_chk', sql`protocol in ${inList(SSO_PROTOCOLS)}`),
    check('sso_provider_domain_chk', sql`domain = lower(btrim(domain)) and length(domain) > 0`),
    check('sso_provider_issuer_chk', sql`length(btrim(issuer)) > 0`),
  ],
);

/**
 * The Better Auth SSO plugin's read model of enabled providers (migration
 * 20261024210000_sso_provider_auth_view, #683). Column keys are the plugin's field names. The
 * plugin resolves a provider before a workspace is known, which the RLS table cannot serve; the
 * view is owner-owned and read-only. `oidcConfig` and `samlConfig` are the `config` JSON as text.
 */
export const ssoProviderAuth = pgView('sso_provider_auth', {
  providerId: text('provider_id').notNull(),
  issuer: text('issuer').notNull(),
  domain: text('domain').notNull(),
  oidcConfig: text('oidc_config'),
  samlConfig: text('saml_config'),
  organizationId: text('organization_id').notNull(),
  userId: text('user_id'),
}).existing();

export const scimToken = tenantTable(
  'scim_token',
  {
    id: id(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    /** sha256 of the token; the plaintext is shown once, at creation. */
    tokenHash: text('token_hash').notNull(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'scim_token_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    uniqueIndex('scim_token_token_hash_uq').on(t.tokenHash),
    check('scim_token_name_chk', sql`length(btrim(name)) between 1 and 100`),
  ],
);

export const provisioningRun = tenantTable(
  'provisioning_run',
  {
    id: id(),
    source: text('source').notNull().$type<ProvisioningSource>(),
    status: text('status').notNull().default('queued').$type<RunStatus>(),
    dryRun: boolean('dry_run').notNull().default(false),
    totalRows: integer('total_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    /** Per-row outcomes and mapping issues. */
    report: jsonb('report').$type<unknown[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'provisioning_run_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    index('provisioning_run_workspace_created_idx').on(t.workspaceId, t.createdAt),
    check('provisioning_run_source_chk', sql`source in ${inList(PROVISIONING_SOURCES)}`),
    check('provisioning_run_status_chk', sql`status in ${inList(RUN_STATUSES)}`),
    check(
      'provisioning_run_counts_chk',
      sql`total_rows >= 0 and created_count >= 0 and skipped_count >= 0 and error_count >= 0`,
    ),
  ],
);

export const migrationRun = tenantTable(
  'migration_run',
  {
    id: id(),
    mode: text('mode').notNull().$type<MigrationMode>(),
    status: text('status').notNull().default('queued').$type<RunStatus>(),
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    /** The next row index to process: a resumed run starts here. */
    resumeFrom: integer('resume_from').notNull().default(0),
    /** Mapping and validation issues found, for the dry-run report. */
    report: jsonb('report').$type<unknown[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('migration_run_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'migration_run_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    index('migration_run_workspace_created_idx').on(t.workspaceId, t.createdAt),
    check('migration_run_mode_chk', sql`mode in ${inList(MIGRATION_MODES)}`),
    check('migration_run_status_chk', sql`status in ${inList(RUN_STATUSES)}`),
    check(
      'migration_run_counts_chk',
      sql`total_rows >= 0 and processed_rows >= 0 and error_rows >= 0 and resume_from >= 0`,
    ),
  ],
);

export const migrationRunRow = tenantTable(
  'migration_run_row',
  {
    id: id(),
    runId: uuid('run_id').notNull(),
    rowIndex: integer('row_index').notNull(),
    state: text('state').notNull().default('pending').$type<MigrationRowState>(),
    /** What the row created, so a rollback can remove exactly that (entity kind and id). */
    entityKind: text('entity_kind'),
    entityId: uuid('entity_id'),
    error: text('error'),
    ...timestamps(),
  },
  (t) => [
    unique('migration_run_row_run_index_uq').on(t.workspaceId, t.runId, t.rowIndex),
    foreignKey({
      name: 'migration_run_row_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'migration_run_row_run_fk',
      columns: [t.workspaceId, t.runId],
      foreignColumns: [migrationRun.workspaceId, migrationRun.id],
    }).onDelete('cascade'),
    check('migration_run_row_state_chk', sql`state in ${inList(MIGRATION_ROW_STATES)}`),
    check('migration_run_row_index_chk', sql`row_index >= 0`),
  ],
);
