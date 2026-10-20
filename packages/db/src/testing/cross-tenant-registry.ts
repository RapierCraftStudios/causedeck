// The cross-tenant registry (#19, #209): every tenant table and every exported `@causedeck/core`
// and `@causedeck/notifications` service names the test that proves workspace B cannot reach
// workspace A through it. The registry tests (`packages/db/src/__tests__/cross-tenant/registry.test.ts`
// for tables, introspected from the live catalog, and `packages/core/src/__tests__/cross-tenant/
// registry.test.ts` and `packages/notifications/src/__tests__/cross-tenant/registry.test.ts` for
// package exports, including the `@causedeck/core/runtime` app seam, #298) fail `pnpm test:tenancy`
// when something is added without an entry here. Data and pure helpers
// only: `@causedeck/db` must not import `@causedeck/core`. See docs/engineering/tenancy.md.

/** Paths are relative to the repository root. */
const DB_TABLES_TEST = 'packages/db/src/__tests__/cross-tenant/tables.test.ts';
const CORE_SERVICES_TEST = 'packages/core/src/__tests__/cross-tenant/services.test.ts';
const WEB_ACTIONS_TEST = 'apps/web/__tests__/cross-tenant-actions.test.ts';
const BILLING_PROCESS_EVENT_TEST =
  'packages/core/src/jobs/definitions/billing-process-event.test.ts';
const BILLING_INVOICE_RENDER_TEST =
  'packages/core/src/jobs/definitions/billing-invoice-render.test.ts';
const BILLING_RECONCILE_TEST = 'packages/core/src/jobs/definitions/billing-reconcile.test.ts';
const USAGE_ROLLUP_TEST = 'packages/core/src/jobs/definitions/usage-rollup.test.ts';
const LIFECYCLE_TEST = 'packages/core/src/lifecycle/__tests__/cross-tenant.test.ts';
const CORE_RUNTIME_TEST = 'packages/core/src/__tests__/cross-tenant/runtime.test.ts';
const NOTIFICATIONS_SERVICES_TEST =
  'packages/notifications/src/__tests__/cross-tenant/services.test.ts';

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
  notification: DB_TABLES_TEST,
  notification_pref: DB_TABLES_TEST,
  notification_setting: DB_TABLES_TEST,
  usage_reservation: DB_TABLES_TEST,
  usage_event: DB_TABLES_TEST,
  budget_override: DB_TABLES_TEST,
  usage_period_summary: DB_TABLES_TEST,
  workspace_feature_flag: DB_TABLES_TEST,
  workspace_key: DB_TABLES_TEST,
  blob: DB_TABLES_TEST,
  saas_invoice: DB_TABLES_TEST,
  saas_invoice_line: DB_TABLES_TEST,
  matter_restriction: DB_TABLES_TEST,
  export_job: DB_TABLES_TEST,
  deletion_job: DB_TABLES_TEST,
  support_session: DB_TABLES_TEST,
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
const lifecycleDenies = { test: LIFECYCLE_TEST, kind: 'denies' } as const;
const lifecycleEmpty = { test: LIFECYCLE_TEST, kind: 'rls-empty' } as const;

/** Exported `@causedeck/core` services that touch the database → their cross-tenant test. */
export const SERVICE_TESTS: Readonly<Record<string, ServiceEntry>> = {
  listMemberships: empty,
  listWorkspacesForUser: empty,
  memberRole: empty,
  requireOwner: denies,
  requireCan: denies,
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
  // workspace profile (#284)
  getWorkspaceProfile: empty,
  updateWorkspaceProfile: denies,
  // role settings (#285)
  getRoleSettings: empty,
  updateRoleSettings: denies,
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
  runBillingProcessEvent: {
    test: BILLING_PROCESS_EVENT_TEST,
    kind: 'self-scoped',
    note: 'reads and updates only the payload workspace inside withWorkspace',
  },
  runBillingInvoiceRender: {
    test: BILLING_INVOICE_RENDER_TEST,
    kind: 'self-scoped',
    note: 'loads the payload invoice inside withWorkspace; another workspace’s invoice is never rendered',
  },
  runBillingReconcile: {
    test: BILLING_RECONCILE_TEST,
    kind: 'self-scoped',
    note: 'system job: lists ids through a definer function, reads each row in its own workspace',
  },
  runUsageRollup: {
    test: USAGE_ROLLUP_TEST,
    kind: 'self-scoped',
    note: 'system job: lists workspace ids through a definer function, writes each workspace inside withWorkspace',
  },
  runNotificationDeliver: selfScoped,
  runNotificationDigest: selfScoped,
  runNotificationDigestSchedule: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'system job: lists workspace ids and timezones only through a definer function',
  },
  record: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'pins the event workspace; app_audit_append rejects any workspace but the pinned one',
  },
  recordRoleChanged: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'record() wrapper (#228); pins the event workspace like record()',
  },
  recordAccessDenied: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'record() wrapper (#228); pins the event workspace like record()',
  },
  recordFlagChanged: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'record() wrapper (#228); pins the event workspace like record()',
  },
  recordExportRun: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'record() wrapper (#228); pins the event workspace like record()',
  },
  recordSupportSessionStarted: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'record() wrapper (#228); pins the event workspace like record()',
  },
  recordSupportSessionEnded: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'record() wrapper (#228); pins the event workspace like record()',
  },
  recordSupportView: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'record() wrapper (#308); pins the event workspace like record()',
  },
  verifyChain: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'reads only the given workspace chain inside withWorkspace; RLS hides other workspaces',
  },
  // audit read and export (#229): the audit.read gate denies non-members and A's id from B's scope
  authorizeAuditRead: denies,
  queryAudit: denies,
  exportAudit: denies,
  recordAiCall: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'inserts under withWorkspace; ws_isolation rejects a row for another workspace',
  },
  restrictMatter: denies,
  assertMatterReadable: denies,
  listMatterRestrictions: denies,
  // support sessions (#308): ub (owner of B, not staff) on A's session and workspace
  requestSession: denies,
  grantSession: denies,
  denySession: denies,
  revokeSession: denies,
  assertActiveSupportSession: denies,
  withSupportSession: denies,
  isActiveStaff: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'reads the global staff_user table only; no tenant rows',
  },
  expireSupportSessions: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'system sweep through app_expire_support_sessions(); touches only elapsed grants',
  },
  endStaffSupportSessions: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: "sweep through app_end_staff_support_sessions(); touches only that staff member's sessions",
  },
  supportSessionExpire: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'system job; runs expireSupportSessions',
  },
  enqueueNotificationDelivery: {
    test: CORE_SERVICES_TEST,
    kind: 'caller-checked',
    note: 'notify() enqueues for its own checked workspace; the deliver job runs scoped to it',
  },
  increment: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on ctx.workspaceId; nested in another workspace scope it throws TenancyError',
  },
  getUsage: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on ctx.workspaceId; nested in another workspace scope it throws TenancyError',
  },
  reserve: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on ctx.workspaceId under an advisory lock; nested in another workspace scope it throws TenancyError',
  },
  commit: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'rejects another workspace reservation (TypeError); scoped to ctx.workspaceId, other scope throws TenancyError',
  },
  release: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'rejects another workspace reservation (TypeError); deletes only ctx.workspaceId rows, other scope throws TenancyError',
  },
  reapExpiredReservations: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'reaps only the context workspace (not a system-wide reaper); other scope throws TenancyError',
  },
  getAiBudget: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on ctx.workspaceId; nested in another workspace scope it throws TenancyError',
  },
  reconcileAiCalls: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on ctx.workspaceId; nested in another workspace scope it throws TenancyError',
  },
  setBudgetOverride: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'staff-only by caller contract; writes only ctx.workspaceId (override and audit row), other scope throws TenancyError',
  },
  activeOverride: {
    test: CORE_SERVICES_TEST,
    kind: 'rls-empty',
    note: 'takes the caller transaction; filters by workspace id and RLS hides other workspaces rows',
  },
  assertWithinFairUse: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'reads entitlements and usage for ctx.workspaceId inside withWorkspace; other scope throws TenancyError',
  },
  checkAiBudgetThresholds: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'reads spend and owners of ctx.workspaceId only and notifies that workspace owners; other scope throws TenancyError',
  },
  getWorkspaceFairnessConcurrency: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on the given workspace id (worker fairness gate); other scope throws TenancyError',
  },
  // lifecycle: workspace export (#301)
  requestExport: lifecycleDenies,
  issueExportDownload: lifecycleDenies,
  openExportDownload: lifecycleDenies,
  getExportJob: lifecycleEmpty,
  listExportJobs: lifecycleEmpty,
  runExportBuild: {
    test: LIFECYCLE_TEST,
    kind: 'self-scoped',
    note: 'export.build: reads and writes only the payload workspace, each page inside withWorkspace',
  },
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
  auditSink: 'delegating audit sink; the default writes through record() in the caller transaction',
  setAuditSink: 'setter',
  // audit: security event emitters (#228)
  createSecurityEventRecorder:
    'factory; its events are account-level record() writes (no workspace data)',
  flagChangeAuditSink:
    'flag audit sink implementation; writes through recordFlagChanged in the caller transaction',
  hashEmail: 'pure',
  // workspace profile (#284)
  PROFILE_FIELDS: 'constant',
  toProfileView: 'pure (drops the id)',
  // role settings (#285)
  ROLE_SETTING_FIELDS: 'constant',
  DEFAULT_ROLE_SETTINGS: 'constant',
  toPolicySettings: 'pure',
  // audit: registry, guards and the default sink (#227)
  recordAuditSink: 'audit sink implementation; writes through record() in the caller transaction',
  AUDIT_ACTIONS: 'constant (audit action registry)',
  AUDIT_EXPORT_COLUMNS: 'constant (audit export column order)',
  AUDIT_BANNED_METADATA_KEYS: 'constant',
  isAuditAction: 'pure',
  isSecurityAction: 'pure',
  assertRedacted: 'pure metadata guard',
  AuditRedactionError: 'error class',
  AiCallContractError: 'error class',
  hashUserAgent: 'pure',
  truncateIpForDisplay: 'pure',
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
  // support sessions (#308): constants and error class
  SUPPORT_GRANT_DEFAULT_MINUTES: 'constant',
  SUPPORT_GRANT_MAX_MINUTES: 'constant',
  SUPPORT_REASON_MAX_LENGTH: 'constant',
  SUPPORT_ACTOR_ROLE: 'constant',
  SupportSessionInactiveError: 'error class',
  systemPing: 'job definition with no database access',
  PermanentError: 'error class',
  RetryableError: 'error class',
  // jobs: producer plumbing (pg-boss schema, not tenant tables)
  createProducer: 'pg-boss producer',
  getProducer: 'pg-boss producer',
  closeProducer: 'pg-boss producer',
  // jobs: billing definitions (#204, #206)
  billingProcessEvent: 'job definition (handler is runBillingProcessEvent)',
  billingProcessEventSchema: 'zod schema',
  billingReconcile: 'job definition (handler is runBillingReconcile)',
  // jobs: invoice render helpers exported for the billing PDF test (#258, #293)
  invoicePdfFilename: 'pure (file name)',
  // jobs: usage rollup (#222)
  usageRollup: 'job definition (handler is runUsageRollup)',
  USAGE_SUMMARY_RETENTION_MONTHS: 'constant',
  // jobs: notification definitions, schemas, helpers and constants (#196)
  notificationDeliver: 'job definition (handler is runNotificationDeliver)',
  notificationDeliverSchema: 'zod schema',
  notificationDigest: 'job definition (handler is runNotificationDigest)',
  notificationDigestSchedule: 'job definition (handler is runNotificationDigestSchedule)',
  notificationDigestSchema: 'zod schema',
  DELIVERY_CHANNELS: 'constant',
  DIGEST_LOCAL_TIME: 'constant',
  DIGEST_ITEM_LIMIT: 'constant',
  DEFAULT_DIGEST_TIMEZONE: 'constant',
  appLink: 'pure (URL)',
  deliveryKey: 'pure (job key)',
  digestDueAt: 'pure (time zone math)',
  digestInstant: 'pure (time zone math)',
  notificationJobDeps: 'transport wiring (no database access)',
  setNotificationJobDeps: 'setter',
  // usage: keys and periods (#219)
  USAGE_KEYS: 'constant',
  USAGE_KEY_KINDS: 'constant',
  USAGE_TIME_ZONE: 'constant',
  IST_OFFSET_MINUTES: 'constant',
  isUsageKey: 'pure',
  usagePeriod: 'pure',
  periodStart: 'pure',
  nextPeriodStart: 'pure',
  incrementSql: 'pure (SQL builder; increment runs it inside withWorkspace)',
  // usage: thresholds, fair-use caps and plan fairness (#221)
  DEFAULT_USAGE_THRESHOLDS: 'constant',
  SOFT_LIMIT_BPS: 'constant',
  HARD_LIMIT_BPS: 'constant',
  USAGE_WARNING_EVENT: 'constant',
  FAIR_USE_KEYS: 'constant',
  FAIR_USE_CAPS: 'constant (cap table)',
  FAIRNESS_CONCURRENCY_BY_PLAN: 'constant (per-plan concurrency table)',
  FairUseError: 'error class',
  resolveThresholds: 'pure (validates ctx.thresholds)',
  hardLimitPaise: 'pure (arithmetic)',
  usageLevel: 'pure (arithmetic)',
  fairnessConcurrencyForPlan: 'pure (table lookup by plan id)',
  usageWarningDedupeKey: 'pure (string builder)',
  usageWarningCopy: 'pure (static notice copy, no data)',
  // usage: AI budget (#220)
  AI_BUDGET_KEY: 'constant',
  RESERVATION_TTL_MS: 'constant',
  BudgetError: 'error class',
  budgetLockSql: 'pure (SQL builder; reserve runs it inside withWorkspace)',
  budgetReadSql: 'pure (SQL builder, workspace id bound; reserve runs it inside withWorkspace)',
  reservationInsertSql:
    'pure (SQL builder, workspace id bound; reserve runs it inside withWorkspace)',
  // usage: ai_call reconciliation (#225)
  reconcileAiCallsSql: 'pure (SQL builder; reconcileAiCalls runs it inside withWorkspace)',
  // lifecycle: export registry, plan, manifest and constants (#301)
  CSV_TABLES: 'constant',
  EXPORT_EXCLUSIONS: 'constant (documented exclusions)',
  exportCoverage: 'pure (registry vs tenant tables)',
  exporterFor: 'pure registry lookup',
  registeredExporters: 'pure registry read',
  registerExporter: 'extension point (process-wide registry, no database access)',
  MANIFEST_PATH: 'constant',
  MANIFEST_VERSION: 'constant',
  README_PATH: 'constant',
  verifyManifest: 'pure',
  planExport: 'pure',
  EXPORT_TTL_MS: 'constant',
  exportFilename: 'pure',
  EXPORT_HISTORY_LIMIT: 'constant',
  EXPORT_TOKEN_NONCE_BYTES: 'constant',
  readExportToken: 'pure (HMAC check)',
};

const notificationDenies = { test: NOTIFICATIONS_SERVICES_TEST, kind: 'denies' } as const;

/**
 * Exported `@causedeck/notifications` services (#194) → their cross-tenant test. Each checks that
 * the user is an active member of the context workspace (`FORBIDDEN`) and touches only their rows.
 */
export const NOTIFICATION_SERVICE_TESTS: Readonly<Record<string, ServiceEntry>> = {
  notify: notificationDenies,
  listForUser: notificationDenies,
  markRead: notificationDenies,
  markAllRead: notificationDenies,
  unreadCount: notificationDenies,
  getPreferences: notificationDenies,
  setPreference: notificationDenies,
  getNotificationSetting: notificationDenies,
  setLockScreenDetails: notificationDenies,
  setCourtHoursQuiet: notificationDenies,
  getDigest: notificationDenies,
  setDigest: notificationDenies,
};

/** Every other runtime export of `@causedeck/notifications`, with why it needs no test. */
export const NOTIFICATION_NOT_A_SERVICE: Readonly<Record<string, string>> = {
  packageName: 'constant',
  CATEGORIES: 'constant (category registry)',
  CATEGORY_KEYS: 'constant',
  CHANNELS: 'constant',
  DIGESTS: 'constant',
  isCategoryKey: 'pure',
  isLockedChannel: 'pure',
  NotificationError: 'error class',
  LIST_LIMIT_MAX: 'constant',
  DEFAULT_NOTIFICATION_SETTINGS: 'constant',
  COURT_HOURS: 'constant',
  isQuietTime: 'pure',
  localMinutes: 'pure',
};

const runtimeDenies = { test: CORE_RUNTIME_TEST, kind: 'denies' } as const;
const runtimeEmpty = { test: CORE_RUNTIME_TEST, kind: 'rls-empty' } as const;
const runtimeSelfScoped = { test: CORE_RUNTIME_TEST, kind: 'self-scoped' } as const;
/** Scope-taking loaders: the web caller (workspace loader / `workspaceAction`) checks membership. */
const runtimeScopeChecked = {
  test: CORE_RUNTIME_TEST,
  kind: 'caller-checked',
  note: 'reads in the given scope (RLS pins it); callers pass a scope loadWorkspaceContext or workspaceAction checked',
} as const;

/**
 * Exported `@causedeck/core/runtime` services (#298), the app's database seam → their cross-tenant
 * test. Each binds the app-role `db` and delegates to a core or package service registered above.
 */
export const RUNTIME_SERVICE_TESTS: Readonly<Record<string, ServiceEntry>> = {
  inWorkspace: runtimeScopeChecked,
  memberRoleFor: runtimeEmpty,
  resolveSlugFor: {
    test: CORE_RUNTIME_TEST,
    kind: 'caller-checked',
    note: 'resolveSlug on the app db; the web workspace loader checks membership',
  },
  listMembershipsFor: runtimeEmpty,
  createWorkspaceFor: runtimeSelfScoped,
  previewInvitationFor: runtimeSelfScoped,
  acceptInvitationFor: runtimeDenies,
  loadMembersPage: runtimeScopeChecked,
  listMembersIn: runtimeScopeChecked,
  loadBillingPage: runtimeScopeChecked,
  loadUsagePage: runtimeScopeChecked,
  openInvoicePdf: {
    test: CORE_RUNTIME_TEST,
    kind: 'rls-empty',
    note: 'finds the invoice in ctx.workspaceId only; the route guard checks membership and invoices.read',
  },
  authorizeAuditReadFor: runtimeDenies,
  queryAuditFeed: runtimeDenies,
  verifyAuditRange: runtimeDenies,
  exportAuditFor: runtimeDenies,
  recordAccessDeniedFor: {
    test: CORE_RUNTIME_TEST,
    kind: 'caller-checked',
    note: "recordAccessDenied on the app db; guard sets member from memberRoleFor, a non-member's denial never lands in that workspace chain",
  },
  requestExportFor: runtimeDenies,
  issueExportDownloadFor: runtimeDenies,
  openExportDownloadFor: runtimeDenies,
  loadNotificationPreferences: runtimeDenies,
  subscribePush: {
    test: CORE_RUNTIME_TEST,
    kind: 'self-scoped',
    note: 'push subscriptions belong to the user, not a workspace; stored for the given user only',
  },
  unsubscribePush: {
    test: CORE_RUNTIME_TEST,
    kind: 'self-scoped',
    note: "revokes only the given user's subscription; another user's endpoint is untouched",
  },
  consumeRequestLimit: {
    test: CORE_RUNTIME_TEST,
    kind: 'self-scoped',
    note: 'global rate-limit counter keyed by the caller (no tenant rows); one key never moves another',
  },
  startAppFlagListener: {
    test: CORE_RUNTIME_TEST,
    kind: 'self-scoped',
    note: 'LISTEN flag_changed on the app pool: only drops the process flag cache, reads no tenant rows',
  },
};

/** Every other runtime export of `@causedeck/core/runtime`, with why it needs no test. */
export const RUNTIME_NOT_A_SERVICE: Readonly<Record<string, string>> = {
  db: 'the lazy app-role handle (Better Auth adapter); tenant reads go through the services above',
  isUuid: 'pure',
  uploadContext:
    'pure (binds the app db into a StorageCtx; the uploads route checks membership and authorize gates each storage call)',
};

/** The storage presign cross-tenant test (#21). */
export const STORAGE_PRESIGN_TEST = 'packages/storage/src/__tests__/cross-tenant-presign.test.ts';

/** Present in the placeholder only; once storage exports presign, the real test must replace it. */
export const STORAGE_PRESIGN_PLACEHOLDER = 'CROSS_TENANT_PRESIGN_PLACEHOLDER';

/** Tenant tables found in the database (or code) with no registered cross-tenant test. */
export function unregisteredTables(liveTenantTables: readonly string[]): string[] {
  return [...new Set(liveTenantTables)].filter((t) => !(t in TABLE_TESTS)).sort();
}

/**
 * Runtime exports that are neither a registered service nor listed as not a service. Defaults to
 * the core maps; pass the notifications maps for `@causedeck/notifications`.
 */
export function unregisteredServices(
  exportNames: readonly string[],
  services: Readonly<Record<string, ServiceEntry>> = SERVICE_TESTS,
  notAService: Readonly<Record<string, string>> = NOT_A_SERVICE,
): string[] {
  return [...new Set(exportNames)]
    .filter((name) => !(name in services) && !(name in notAService))
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
      ...Object.values(NOTIFICATION_SERVICE_TESTS).map((entry) => entry.test),
      ...Object.values(RUNTIME_SERVICE_TESTS).map((entry) => entry.test),
      STORAGE_PRESIGN_TEST,
    ]),
  ].sort();
}
