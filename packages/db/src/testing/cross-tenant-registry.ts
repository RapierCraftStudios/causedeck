// The cross-tenant registry (#19, #209): every tenant table and every exported `@causedeck/core`
// service names the test that proves workspace B cannot reach workspace A through it. The registry
// tests (`packages/db/src/__tests__/cross-tenant/registry.test.ts` for tables, introspected from the
// live catalog, and `packages/core/src/__tests__/cross-tenant/registry.test.ts` for core exports)
// fail `pnpm test:tenancy` when something is added without an entry here. Data and pure helpers
// only: `@causedeck/db` must not import `@causedeck/core`. See docs/engineering/tenancy.md.

/** Paths are relative to the repository root. */
const DB_TABLES_TEST = 'packages/db/src/__tests__/cross-tenant/tables.test.ts';
const CORE_SERVICES_TEST = 'packages/core/src/__tests__/cross-tenant/services.test.ts';
const WEB_ACTIONS_TEST = 'apps/web/__tests__/cross-tenant-actions.test.ts';

/** Tenant table (and the tenant root `organization`) → its cross-tenant SQL test. */
export const TABLE_TESTS: Readonly<Record<string, string>> = {
  organization: DB_TABLES_TEST,
  member: DB_TABLES_TEST,
  invitation: DB_TABLES_TEST,
  workspace_settings: DB_TABLES_TEST,
  workspace_slug_history: DB_TABLES_TEST,
  job_effect: DB_TABLES_TEST,
  subscription: DB_TABLES_TEST,
  entitlement: DB_TABLES_TEST,
  usage_counter: DB_TABLES_TEST,
  billing_event: DB_TABLES_TEST,
  audit_event: DB_TABLES_TEST,
  ai_call: DB_TABLES_TEST,
  workspace_key: DB_TABLES_TEST,
  usage_reservation: DB_TABLES_TEST,
  usage_event: DB_TABLES_TEST,
  budget_override: DB_TABLES_TEST,
  usage_period_summary: DB_TABLES_TEST,
};

/**
 * Append-only tenant tables (#226): the app role has no UPDATE or DELETE, so the cross-tenant suite
 * expects a permission error (42501) where it would otherwise expect zero rows.
 */
export const APPEND_ONLY_TABLES: readonly string[] = ['audit_event', 'ai_call'];

/**
 * How a service is proven safe when user B passes workspace A's ids:
 * - `denies`: it rejects with NOT_FOUND or FORBIDDEN (or the invitation equivalent).
 * - `rls-empty`: a read that returns nothing of A's (an empty list, zero, or no A entry).
 * - `self-scoped`: it opens its own scope from what it is given and never returns another
 *   workspace's rows.
 * - `caller-checked`: by contract it trusts its caller for membership; `test` covers that caller.
 */
export type CrossTenantKind = 'denies' | 'rls-empty' | 'self-scoped' | 'caller-checked';

export interface ServiceEntry {
  test: string;
  kind: CrossTenantKind;
  note?: string;
}

const denies = { test: CORE_SERVICES_TEST, kind: 'denies' } as const;
const empty = { test: CORE_SERVICES_TEST, kind: 'rls-empty' } as const;
const selfScoped = { test: CORE_SERVICES_TEST, kind: 'self-scoped' } as const;

/** Exported `@causedeck/core` services that touch the database → their cross-tenant test. */
export const SERVICE_TESTS: Readonly<Record<string, ServiceEntry>> = {
  listMemberships: empty,
  listWorkspacesForUser: empty,
  memberRole: empty,
  requireOwner: denies,
  listMembers: empty,
  changeRole: denies,
  removeMember: denies,
  prepareOwnershipTransfer: denies,
  transferOwnership: denies,
  countBillableSeats: empty,
  countOpenWork: empty,
  offboardMember: denies,
  inviteMember: denies,
  reissueInvitation: denies,
  revokeInvitation: denies,
  listPendingInvitations: empty,
  acceptInvitation: denies,
  previewInvitation: selfScoped,
  generateUniqueSlug: selfScoped,
  renameSlug: denies,
  resolveSlug: {
    test: WEB_ACTIONS_TEST,
    kind: 'caller-checked',
    note: 'returns the workspace for any slug; the web workspace loader checks membership',
  },
  createWorkspace: selfScoped,
  softDeleteWorkspace: denies,
  entitlements: {
    test: CORE_SERVICES_TEST,
    kind: 'caller-checked',
    note: 'seat gate called by invite and accept after their own workspace checks',
  },
  runJob: selfScoped,
  once: selfScoped,
  enqueue: {
    test: CORE_SERVICES_TEST,
    kind: 'caller-checked',
    note: 'sends the payload as given; runJob scopes the handler to the payload workspace',
  },
  retentionSweep: selfScoped,
};

/** Every other runtime export of `@causedeck/core`, with why it needs no cross-tenant test. */
export const NOT_A_SERVICE: Readonly<Record<string, string>> = {
  packageName: 'constant',
  // workspaces: errors
  WorkspaceError: 'error class',
  InvitationError: 'error class',
  InvalidCursorError: 'error class',
  notFound: 'error factory',
  forbidden: 'error factory',
  conflict: 'error factory',
  invalid: 'error factory',
  rateLimited: 'error factory',
  isUniqueViolation: 'pure error predicate',
  // workspaces: pure helpers and constants
  liveWorkspace: 'SQL predicate fragment',
  activeMember: 'SQL predicate fragment',
  encodeWorkspaceCursor: 'pure',
  decodeWorkspaceCursor: 'pure',
  slugify: 'pure',
  SLUG_REDIRECT_DAYS: 'constant',
  INVITATION_TTL_MS: 'constant',
  INVITE_RATE_LIMIT: 'constant',
  ACCEPT_RATE_LIMIT: 'constant',
  generateInvitationToken: 'pure (random bytes)',
  hashInvitationToken: 'pure',
  // workspaces: extension points (process-wide wiring, no database access of their own)
  permissiveEntitlements: 'default entitlements implementation (allows everything, no queries)',
  setEntitlements: 'setter',
  registerReassignProvider: 'setter',
  clearReassignProviders: 'setter',
  noopAuditSink: 'audit sink implementation (no queries)',
  consoleAuditSink: 'audit sink implementation (logs only)',
  auditSink: 'delegating audit sink; writes inside the caller transaction',
  setAuditSink: 'setter',
  // jobs: definitions, schemas and constants
  DEFAULT_CONCURRENCY: 'constant',
  DEFAULT_FAIRNESS_CONCURRENCY: 'constant',
  DEFAULT_RETRY: 'constant',
  DEFAULT_TIMEOUT_SEC: 'constant',
  JOB_NAME_PATTERN: 'constant',
  JOB_EFFECT_RETENTION_DAYS: 'constant',
  BANNED_PAYLOAD_FIELDS: 'constant',
  PGBOSS_SCHEMA: 'constant',
  deadLetterQueue: 'pure (queue name)',
  defineJob: 'pure (builds a definition)',
  isSystemJob: 'pure',
  fairnessKeySchema: 'zod schema',
  workspaceIdSchema: 'zod schema',
  contentFieldViolations: 'pure payload lint',
  createRegistry: 'pure (builds a job map)',
  registry: 'job definition map',
  systemPing: 'job definition with no database access',
  PermanentError: 'error class',
  RetryableError: 'error class',
  // jobs: producer plumbing (pg-boss schema, not tenant tables)
  createProducer: 'pg-boss producer',
  getProducer: 'pg-boss producer',
  closeProducer: 'pg-boss producer',
};

/** The storage presign cross-tenant test (#21). */
export const STORAGE_PRESIGN_TEST = 'packages/storage/src/__tests__/cross-tenant-presign.test.ts';

/** Present in the placeholder only; once storage exports presign, the real test must replace it. */
export const STORAGE_PRESIGN_PLACEHOLDER = 'CROSS_TENANT_PRESIGN_PLACEHOLDER';

/** Tenant tables found in the database (or code) with no registered cross-tenant test. */
export function unregisteredTables(liveTenantTables: readonly string[]): string[] {
  return [...new Set(liveTenantTables)].filter((t) => !(t in TABLE_TESTS)).sort();
}

/** Core runtime exports that are neither a registered service nor listed as not a service. */
export function unregisteredServices(exportNames: readonly string[]): string[] {
  return [...new Set(exportNames)]
    .filter((name) => !(name in SERVICE_TESTS) && !(name in NOT_A_SERVICE))
    .sort();
}

/** Registry entries whose table or export no longer exists. */
export function staleEntries(
  registered: Readonly<Record<string, unknown>>,
  existing: readonly string[],
): string[] {
  const names = new Set(existing);
  return Object.keys(registered)
    .filter((name) => !names.has(name))
    .sort();
}

/** Every test file the registry points at (for the file-exists check). */
export function registeredTestFiles(): string[] {
  return [
    ...new Set([
      ...Object.values(TABLE_TESTS),
      ...Object.values(SERVICE_TESTS).map((entry) => entry.test),
      STORAGE_PRESIGN_TEST,
    ]),
  ].sort();
}
