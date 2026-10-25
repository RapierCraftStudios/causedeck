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
const ACCOUNT_DELETION_TEST = 'packages/core/src/lifecycle/__tests__/account-deletion.test.ts';
const MEMORY_ERASURE_TEST = 'packages/core/src/lifecycle/__tests__/memory-erasure.test.ts';
const CORE_RUNTIME_TEST = 'packages/core/src/__tests__/cross-tenant/runtime.test.ts';
const ADMIN_STAFF_CLI_TEST = 'apps/admin/src/cli/staff.test.ts';
const CORE_ROSTERS_TEST = 'packages/core/src/__tests__/cross-tenant/rosters.test.ts';
const CORE_NEXT_DATE_CHOICE_TEST =
  'packages/core/src/__tests__/cross-tenant/next-date-choice.test.ts';
const CORE_MOVE_PREVIEW_TEST = 'packages/core/src/__tests__/cross-tenant/move-preview.test.ts';
const CORE_DOCUMENT_PREVIEW_TEST =
  'packages/core/src/__tests__/cross-tenant/document-preview.test.ts';
const CORE_AUTOMATION_TEST = 'packages/core/src/__tests__/cross-tenant/automation.test.ts';
const CORE_WHATSAPP_LINK_TEST = 'packages/core/src/__tests__/cross-tenant/whatsapp-link.test.ts';
const CORE_PORTFOLIO_TEST = 'packages/core/src/__tests__/cross-tenant/portfolio.test.ts';
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
  ai_call_result: DB_TABLES_TEST,
  news_pref: DB_TABLES_TEST,
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
  contribution_ledger: DB_TABLES_TEST,
  export_job: DB_TABLES_TEST,
  deletion_job: DB_TABLES_TEST,
  support_session: DB_TABLES_TEST,
  workspace_integration: DB_TABLES_TEST,
  // Email forward-in intake (#54 part 2).
  intake_address: DB_TABLES_TEST,
  intake_allowlist: DB_TABLES_TEST,
  intake_message: DB_TABLES_TEST,
  // Global-or-workspace reference tables (#344): catalogue rows are covered by court-schema.test.ts.
  forum: DB_TABLES_TEST,
  court_hall: DB_TABLES_TEST,
  bench: DB_TABLES_TEST,
  // Drafting (#766): template is global-or-workspace; draft_version is immutable.
  template: DB_TABLES_TEST,
  draft: DB_TABLES_TEST,
  draft_version: DB_TABLES_TEST,
  // Matter and documents (#345).
  matter: DB_TABLES_TEST,
  document: DB_TABLES_TEST,
  document_page: DB_TABLES_TEST,
  anchor: DB_TABLES_TEST,
  // Proceedings (#346).
  proceeding: DB_TABLES_TEST,
  proceeding_link: DB_TABLES_TEST,
  // Proceeding state history (#363).
  proceeding_state_change: DB_TABLES_TEST,
  // Docket (#347).
  listing: DB_TABLES_TEST,
  hearing: DB_TABLES_TEST,
  appearance: DB_TABLES_TEST,
  order: DB_TABLES_TEST,
  obligation: DB_TABLES_TEST,
  task: DB_TABLES_TEST,
  // People (#348).
  person: DB_TABLES_TEST,
  organisation: DB_TABLES_TEST,
  role_edge: DB_TABLES_TEST,
  // Adapter parse health (#372).
  adapter_parse_run: DB_TABLES_TEST,
  // Bench rosters (#384).
  bench_roster: DB_TABLES_TEST,
  bench_roster_entry: DB_TABLES_TEST,
  bench_change_alert: DB_TABLES_TEST,
  // Automation engine (#47).
  proposal: DB_TABLES_TEST,
  activity: DB_TABLES_TEST,
  automation_preference: DB_TABLES_TEST,
  automation_threshold: DB_TABLES_TEST,

  // Capture inbox (#43).
  capture: DB_TABLES_TEST,
  workspace_capture_channel: DB_TABLES_TEST,

  // Calendar interop (#53).
  ics_feed: DB_TABLES_TEST,
  ics_feed_event: DB_TABLES_TEST,
  ics_import_event: DB_TABLES_TEST,

  // Case-status watch (#589).
  case_watch: DB_TABLES_TEST,
  case_status_snapshot: DB_TABLES_TEST,

  // Review and correction queue (#518).
  review_correction: DB_TABLES_TEST,

  // Anchored order extraction (#46).
  extraction: DB_TABLES_TEST,

  // Bootstrap import (#57, #546).
  import_batch: DB_TABLES_TEST,
  import_batch_file: DB_TABLES_TEST,
  import_plan: DB_TABLES_TEST,

  // Advocate identifiers for the bootstrap import (#57, #550).
  advocate_profile: DB_TABLES_TEST,

  // Public API keys (#624).
  api_key: DB_TABLES_TEST,

  // Change webhooks (#626).
  webhook_endpoint: DB_TABLES_TEST,
  webhook_delivery: DB_TABLES_TEST,
  // Institution portfolios (#661).
  portfolio: DB_TABLES_TEST,
  portfolio_case: DB_TABLES_TEST,
  portfolio_panel_advocate: DB_TABLES_TEST,

  // WhatsApp number link and OTP challenge (#678).
  whatsapp_link: DB_TABLES_TEST,
  whatsapp_otp_challenge: DB_TABLES_TEST,
  whatsapp_inbound_message: DB_TABLES_TEST,
  // Enterprise onboarding (#682).
  sso_provider: DB_TABLES_TEST,
  scim_token: DB_TABLES_TEST,
  provisioning_run: DB_TABLES_TEST,
  migration_run: DB_TABLES_TEST,
  migration_run_row: DB_TABLES_TEST,

  // Karnataka HC cause-list watches (#482).
  cause_list_watch: DB_TABLES_TEST,
  // Judgment alerts (#497).
  matter_issue_tag: DB_TABLES_TEST,
  judgment_alert: DB_TABLES_TEST,
  // Official notices feed (#584).
  notice_match: DB_TABLES_TEST,
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
const rosterDenies = { test: CORE_ROSTERS_TEST, kind: 'denies' } as const;
const rosterSelfScoped = {
  test: CORE_ROSTERS_TEST,
  kind: 'self-scoped',
  note: 'opens withWorkspace on the given workspace id; RLS limits rosters and entries to that workspace',
} as const;
const nextDateChoiceDenies = { test: CORE_NEXT_DATE_CHOICE_TEST, kind: 'denies' } as const;
const movePreviewDenies = { test: CORE_MOVE_PREVIEW_TEST, kind: 'denies' } as const;
const documentPreviewDenies = { test: CORE_DOCUMENT_PREVIEW_TEST, kind: 'denies' } as const;
const automationDenies = { test: CORE_AUTOMATION_TEST, kind: 'denies' } as const;

/** Exported `@causedeck/core` services that touch the database → their cross-tenant test. */
export const SERVICE_TESTS: Readonly<Record<string, ServiceEntry>> = {
  listMemberships: empty,
  listWorkspacesForUser: empty,
  memberRole: empty,
  ownerGrace: empty,
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
  addProvisionedMember: {
    test: CORE_SERVICES_TEST,
    kind: 'caller-checked',
    note: 'trusts its caller (a SCIM token or a member holding member.invite); a B-scoped call for workspace A fails on RLS and adds no member',
  },
  deactivateProvisionedMember: {
    test: CORE_SERVICES_TEST,
    kind: 'caller-checked',
    note: 'trusts its caller (a SCIM token); a B-scoped call for workspace A finds no member row and changes nothing',
  },
  reissueInvitation: denies,
  revokeInvitation: denies,
  listPendingInvitations: empty,
  // workspace profile (#284)
  getWorkspaceProfile: empty,
  updateWorkspaceProfile: denies,
  // clerk setup approval (#505)
  getClerkSetup: empty,
  requestClerkSetupApproval: denies,
  approveClerkSetup: denies,
  // role settings (#285)
  getRoleSettings: empty,
  updateRoleSettings: denies,
  // privacy settings (#286)
  getPrivacySettings: empty,
  updateWorkspacePrivacy: denies,
  // integration tokens (#287)
  getIntegrations: empty,
  rotateIntegrationToken: denies,
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
  // KHC cause-list watches (#482)
  addCauseListWatch: selfScoped,
  matchNotices: selfScoped,
  notifyNoticeMatches: selfScoped,
  listHolidayListings: selfScoped,
  // Deadline engine and orders poll (#494): B's matched notices and B's watch never reach A
  loadCourtCalendar: selfScoped,
  pollOrders: selfScoped,
  listCauseListWatches: selfScoped,
  removeCauseListWatch: selfScoped,
  // Conflict-of-interest checks (#500): B's check sees none of A's parties
  checkConflicts: empty,
  // Cross-checked facts (#499): B's agreement for A's proceeding is empty
  getNextDateAgreement: empty,
  getStageAgreement: empty,
  // Case-status watches (#591)
  addCaseWatch: selfScoped,
  listCaseWatches: selfScoped,
  removeCaseWatch: selfScoped,
  // Institution portfolios (#663): B's call on A's portfolio is denied; B's lists are empty
  importPortfolioCases: { test: CORE_PORTFOLIO_TEST, kind: 'denies' },
  listPortfolioCases: { test: CORE_PORTFOLIO_TEST, kind: 'denies' },
  portfolioSummary: { test: CORE_PORTFOLIO_TEST, kind: 'denies' },
  exportPortfolioCsv: { test: CORE_PORTFOLIO_TEST, kind: 'denies' },
  // Portfolio list and create (#666): B cannot list or create in A's workspace; B's list has no A row.
  listPortfolios: { test: CORE_PORTFOLIO_TEST, kind: 'denies' },
  createPortfolio: { test: CORE_PORTFOLIO_TEST, kind: 'denies' },
  // WhatsApp link (#678): B cannot request, verify, unlink or read A's link, challenge or target.
  requestWhatsAppOtp: { test: CORE_WHATSAPP_LINK_TEST, kind: 'denies' },
  verifyWhatsAppOtp: { test: CORE_WHATSAPP_LINK_TEST, kind: 'denies' },
  unlinkWhatsApp: { test: CORE_WHATSAPP_LINK_TEST, kind: 'denies' },
  setWhatsAppCategories: { test: CORE_WHATSAPP_LINK_TEST, kind: 'denies' },
  getWhatsAppLink: { test: CORE_WHATSAPP_LINK_TEST, kind: 'denies' },
  getWhatsAppSendTarget: { test: CORE_WHATSAPP_LINK_TEST, kind: 'denies' },
  // Inbound WhatsApp (#680): the workspace comes only from the sender's verified link.
  receiveInboundWhatsApp: { test: CORE_WHATSAPP_LINK_TEST, kind: 'denies' },
  runWhatsAppIntake: { test: CORE_WHATSAPP_LINK_TEST, kind: 'denies' },
  // Exception alerts (#665): the scan opens withWorkspace on the given workspace id only.
  scanPortfolioAlerts: {
    test: CORE_PORTFOLIO_TEST,
    kind: 'self-scoped',
    note: "opens withWorkspace on the given workspace id and notifies that workspace's members; RLS keeps every other workspace out",
  },
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
  // News digest (#481): a member of B never reads or writes A's preferences, digest or recipients.
  getNewsPref: denies,
  setNewsPref: denies,
  markNewsDigestSent: denies,
  listNewsForMember: denies,
  selectNewsDigestItems: denies,
  listNewsDigestRecipients: empty,
  runNewsDigestMember: selfScoped,
  runNewsDigest: selfScoped,
  runNewsDigestSchedule: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'system job: lists workspace ids and timezones only through a definer function',
  },
  runNotificationDeliver: selfScoped,
  runNotificationDigest: selfScoped,
  // End-of-day digest (#49): B's digest never counts, names or emails A's activity.
  runActivityDigest: selfScoped,
  runActivityDigestMember: selfScoped,
  runActivityDigestSchedule: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'system job: lists workspace ids and timezones only through a definer function',
  },
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
  // court document network (#485): a contribution reads the caller's own document under RLS
  checkEligibility: denies,
  contributeDocument: denies,
  withdrawContributions: denies,
  assertMatterReadable: denies,
  listMatterRestrictions: denies,
  // court (#34): catalogue rows are global by design; custom forums stay in their workspace
  createWorkspaceForum: denies,
  listForums: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: "opens withWorkspace on the given workspace id; RLS shows the catalogue and that workspace's own forums only",
  },
  listForumsByCity: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: "opens withWorkspace on the given workspace id; RLS shows the catalogue and that workspace's own forums only",
  },
  getForum: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: "opens withWorkspace on the given workspace id; another workspace's forum is NOT_FOUND",
  },
  // adapter health (#372): the tenant-free summary view
  getAdapterHealthSummary: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'reads the tenant-free adapter_health_summary view (counts per adapter/version only), never a tenant row',
  },
  // court read models (#397)
  getCourtsIndex: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on the given workspace id; RLS limits parse runs and custom forums to that workspace',
  },
  getForumDetail: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: "opens withWorkspace on the given workspace id; RLS limits parse runs and custom forums to that workspace; another workspace's forum code is NOT_FOUND",
  },
  getAdapterStatus: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on the given workspace id; RLS limits parse runs and custom forums to that workspace',
  },
  // court: roster services (#387), cases in their own file beside services.test.ts
  confirmRosterImport: rosterDenies,
  supersede: rosterDenies,
  getRosterAt: rosterSelfScoped,
  resolveBenchForHall: rosterSelfScoped,
  listRosters: rosterSelfScoped,
  // court: bench-change alerts (#389)
  detectBenchChanges: rosterDenies,
  listAlerts: rosterDenies,
  dismissAlert: rosterDenies,
  // court: rosters page read model (#434)
  getRostersPage: rosterDenies,
  listHallsSeen: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on the given workspace id; RLS limits parse runs and custom forums to that workspace',
  },
  // matter graph (#362): A's ids from B, or ub claiming A, are NOT_FOUND; links across workspaces
  // fail with CrossWorkspaceError (a NOT_FOUND WorkspaceError); so do merges and splits (#365) that
  // name a row of another workspace, and undos handed a payload of A's ids
  // court day (#493): the live halls read model opens withWorkspace on the given actor
  getLiveHalls: denies,
  // bench card (#521): the flagged read model opens withWorkspace on the given actor
  getBenchCard: denies,
  createMatter: denies,
  updateMatter: denies,
  archiveMatter: denies,
  listMatters: empty,
  createProceeding: denies,
  updateIdentifiers: denies,
  linkProceedings: denies,
  // proceeding state machine (#363): A's proceeding from B, or ub claiming A, is NOT_FOUND
  transitionProceeding: denies,
  findDuplicateProceedings: empty,
  createDocument: denies,
  mergeMatters: denies,
  undoMerge: denies,
  splitMatter: denies,
  undoSplit: denies,
  mergeProceedings: denies,
  undoMergeProceedings: denies,
  // merge and split previews (#392): A's matters or proceedings from B, or ub claiming A, are denied
  previewMergeMatters: movePreviewDenies,
  previewSplitMatter: movePreviewDenies,
  // canonical next date (#364): A's proceeding or listing from B, or ub claiming A, is NOT_FOUND
  proposeNextDate: denies,
  confirmNextDate: denies,
  // conflict card resolution (#390): A's listings from B, or ub claiming A, are NOT_FOUND
  chooseNextDateSource: nextDateChoiceDenies,
  // Automation engine (#47): B cannot submit, resolve, undo, read or export A's proposals and activity.
  submitProposals: automationDenies,
  acceptProposal: automationDenies,
  editAndAccept: automationDenies,
  dismissProposal: automationDenies,
  applyAutomatically: automationDenies,
  expireProposals: automationDenies,
  // Activity feed read model (#49): B reads, counts and digests only B's own activities.
  listActivities: automationDenies,
  getActivityDetail: automationDenies,
  countByDay: automationDenies,
  countDigestActivities: automationDenies,
  exportActivities: automationDenies,
  listProposalsForDigest: automationDenies,
  getAskFirst: automationDenies,
  setAskFirst: automationDenies,
  confirmActivity: automationDenies,
  previewUndo: automationDenies,
  undoActivity: automationDenies,
  undoCapture: automationDenies,
  reassignCapture: automationDenies,
  getInbox: automationDenies,
  getCanonicalNextDate: denies,
  // matter timeline (#366): A's matter from B, or ub claiming A, is NOT_FOUND
  getMatterTimeline: denies,
  // matter graph and timeline anchors (#41): A's matter from B, or ub claiming A, is NOT_FOUND
  getMatterGraph: denies,
  getTimelineAnchors: denies,
  // matters read models and people (#386): A's matter or person from B, or ub claiming A, is
  // NOT_FOUND; a search from B lists none of A's matters
  searchMatters: empty,
  getMatterOverview: denies,
  listMatterProceedingsTree: denies,
  listMatterPeople: denies,
  listMatterDocuments: denies,
  upsertPerson: denies,
  setRoleEdge: denies,
  setSensitive: denies,
  // document preview (#393): A's document from B, or ub claiming A, is NOT_FOUND
  getDocumentPreview: documentPreviewDenies,
  // business dashboard (#519): a non-staff user is refused by app_staff_business_snapshot
  staffBusinessSnapshot: denies,
  // support sessions (#308): ub (owner of B, not staff) on A's session and workspace
  requestSession: denies,
  grantSession: denies,
  denySession: denies,
  revokeSession: denies,
  assertActiveSupportSession: denies,
  withSupportSession: denies,
  // the owner's support page and shell banner (#313)
  listSupportSessions: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on the given workspace id; nested in another workspace scope it throws TenancyError',
  },
  activeSupportSession: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on the given workspace id; nested in another workspace scope it throws TenancyError',
  },
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
  // the staff console (#314): a staff member's own sessions and the read-only workspace view
  listStaffSupportSessions: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: "withUser on the staff id; only the staff_self policy exposes rows: that staff member's own sessions",
  },
  staffSupportSession: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: "withUser on the staff id; only the staff_self policy exposes rows: that staff member's own sessions",
  },
  readSupportWorkspaceView: denies,
  // platform staff accounts (#309): the admin console's reads and the operator CLI's writes
  staffMember: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'reads the global staff_user table only; no tenant rows',
  },
  countActiveStaff: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'counts the global staff_user table only; no tenant rows',
  },
  // staff console reads (#310): owner-defined functions that refuse anyone but enabled staff
  staffWorkspaceSearch: {
    test: CORE_SERVICES_TEST,
    kind: 'denies',
    note: 'app_staff_workspace_search() runs only for an enabled staff_user; others are FORBIDDEN',
  },
  staffWorkspaceMetadata: {
    test: CORE_SERVICES_TEST,
    kind: 'denies',
    note: 'app_staff_workspace_metadata() runs only for an enabled staff_user; others are FORBIDDEN',
  },
  staffAuditEvents: {
    test: CORE_SERVICES_TEST,
    kind: 'denies',
    note: 'app_staff_audit_events() runs only for an enabled staff_user; others are FORBIDDEN',
  },
  // staff workspace usage (#224)
  staffWorkspaceUsage: {
    test: CORE_SERVICES_TEST,
    kind: 'denies',
    note: 'app_staff_workspace_usage() and app_staff_budget_overrides() run only for an enabled staff_user; others are FORBIDDEN',
  },
  addStaff: {
    test: ADMIN_STAFF_CLI_TEST,
    kind: 'caller-checked',
    note: 'owner-role write of the global staff_user table; only the operator CLI calls it',
  },
  disableStaff: {
    test: ADMIN_STAFF_CLI_TEST,
    kind: 'caller-checked',
    note: "owner-role write of staff_user, then ends only that staff member's support sessions",
  },
  seedDevStaff: {
    test: ADMIN_STAFF_CLI_TEST,
    kind: 'caller-checked',
    note: 'creates the dev staff account; the CLI refuses it in production',
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
  createApiKey: {
    test: CORE_SERVICES_TEST,
    kind: 'denies',
    note: 'requireCan inside the workspace scope; a non-member is FORBIDDEN and a nested scope throws TenancyError',
  },
  listApiKeys: {
    test: CORE_SERVICES_TEST,
    kind: 'denies',
    note: 'requireCan inside the workspace scope; keys are tenant rows under RLS',
  },
  revokeApiKey: {
    test: CORE_SERVICES_TEST,
    kind: 'denies',
    note: 'requireCan inside the workspace scope; another workspace key id is NOT_FOUND',
  },
  authenticateApiKey: {
    test: CORE_SERVICES_TEST,
    kind: 'caller-checked',
    note: 'the bearer token is the credential: reads one key through the owner-defined app_api_key_by_hash, by hash only (never lists)',
  },
  findApiKeyIssuer: {
    test: CORE_SERVICES_TEST,
    kind: 'caller-checked',
    note: 'reads one user row by id for the key issuer (the user table has no workspace column); the caller passes the issuer id from an authenticated key',
  },
  apiKeyCallsThisPeriod: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on ctx.workspaceId; nested in another workspace scope it throws TenancyError',
  },
  consumeApiCall: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on ctx.workspaceId; nested in another workspace scope it throws TenancyError',
  },
  createWebhookEndpoint: {
    test: CORE_SERVICES_TEST,
    kind: 'denies',
    note: 'requireCan inside the workspace scope; a non-member is FORBIDDEN and a nested scope throws TenancyError',
  },
  listWebhookEndpoints: {
    test: CORE_SERVICES_TEST,
    kind: 'denies',
    note: 'requireCan inside the workspace scope; endpoints are tenant rows under RLS',
  },
  deleteWebhookEndpoint: {
    test: CORE_SERVICES_TEST,
    kind: 'denies',
    note: 'requireCan inside the workspace scope; another workspace endpoint id is NOT_FOUND',
  },
  emitWebhookEvent: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on input.workspaceId and fans out only to that workspace endpoints; nested in another workspace scope it throws TenancyError',
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
  expireBudgetOverride: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'staff-only by caller contract; updates only an active override of ctx.workspaceId (and its audit row), other scope throws TenancyError',
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
  // lifecycle: workspace deletion (#302)
  requestWorkspaceDeletion: lifecycleDenies,
  cancelWorkspaceDeletion: lifecycleDenies,
  getActiveWorkspaceDeletion: lifecycleEmpty,
  runWorkspaceErase: {
    test: LIFECYCLE_TEST,
    kind: 'self-scoped',
    note: 'deletion.erase: every read and write inside withWorkspace on the payload workspace; finalize refuses any other workspace',
  },
  runDeletionTick: {
    test: LIFECYCLE_TEST,
    kind: 'self-scoped',
    note: 'system.deletion.tick: lists due ids through app_deletion_due_jobs, then updates each job in its own workspace scope',
  },
  // lifecycle: account deletion and memory erasure (#303)
  requestAccountDeletion: {
    test: ACCOUNT_DELETION_TEST,
    kind: 'self-scoped',
    note: "the caller's own account only (withUser); a deletion job is visible to its user alone (account_self)",
  },
  runAccountDeletion: {
    test: ACCOUNT_DELETION_TEST,
    kind: 'self-scoped',
    note: "account.delete: loads the job for its own user only; another user's job id is missing and nothing of theirs changes",
  },
  soleOwnedWorkspaces: {
    test: ACCOUNT_DELETION_TEST,
    kind: 'self-scoped',
    note: "the user's own memberships (member_self), each owner count inside that workspace's withWorkspace",
  },
  requestMemoryErasure: { test: MEMORY_ERASURE_TEST, kind: 'denies' },
  runMemoryErasure: {
    test: MEMORY_ERASURE_TEST,
    kind: 'self-scoped',
    note: "memory.erase: only the payload workspace; another workspace's job id is missing",
  },
  eraseMemory: {
    test: MEMORY_ERASURE_TEST,
    kind: 'self-scoped',
    note: 'deletes inside withWorkspace on the given id; RLS keeps every other workspace out',
  },
  // judgment alerts (#497)
  listTags: denies,
  addTag: denies,
  proposeTags: denies,
  confirmTag: denies,
  dismissTag: denies,
  listRelevantJudgments: denies,
  // notices page and matter card (#588)
  listWorkspaceNotices: empty,
  getPublicCase: empty,
  listPublicCauseLists: empty,
  listPublicOrders: empty,
  listPublicNotices: selfScoped,
  listMatterNotices: denies,
  // bench-notice alerts (#496)
  listBenchNoticeAlerts: empty,
  notifyBenchNoticeAlerts: selfScoped,
  scanJudgments: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'opens withWorkspace on the given workspace id; RLS keeps every other workspace out',
  },
  // citations (#484): the global corpus, one answer for every workspace
  verifyCitation: {
    test: CORE_SERVICES_TEST,
    kind: 'self-scoped',
    note: 'global table `judgment` (GLOBAL_TABLES, no workspace_id, no RLS): public judgments, the same answer in every workspace; reads nothing tenant-scoped',
  },
};

/** Every other runtime export of `@causedeck/core`, with why it needs no cross-tenant test. */
export const NOT_A_SERVICE: Readonly<Record<string, string>> = {
  packageName: 'constant',
  // whatsapp-link (#678): constants
  WHATSAPP_OTP_TTL_MS: 'constant',
  WHATSAPP_OTP_RESEND_COOLDOWN_MS: 'constant',
  WHATSAPP_OTP_MAX_ATTEMPTS: 'constant',
  whatsappInboundProviderFromProcess: 'env factory, no tenant data',
  // portfolio (#663): pure CSV reader and constants
  parsePortfolioCsv: 'pure',
  MAX_PORTFOLIO_IMPORT_ROWS: 'constant',
  MAX_PORTFOLIO_WATCHES_PER_ADVOCATE: 'constant',
  PORTFOLIO_ALERT_MAX_CASES: 'constant',
  PORTFOLIO_WATCH_CADENCE_MINUTES: 'constant',
  PORTFOLIO_EXPORT_HEADER: 'constant',
  // business dashboard (#519): pure maths and rendering over aggregates
  assessAgreement: 'pure',
  UNKNOWN_CONFIDENCE: 'constant',
  nameKey: 'pure',
  nameSimilarity: 'pure',
  nameTokens: 'pure',
  transliterate: 'pure',
  parseBusinessSnapshot: 'pure',
  buildBusinessReport: 'pure',
  businessConfigFromEnv: 'pure',
  evaluateCostThresholds: 'pure',
  renderBusinessDigest: 'pure',
  renderCostAlert: 'pure',
  readBusinessSnapshot:
    'system read of app_business_snapshot (job use, no staff user): plan ids and counts, sums and dollar totals only, never a workspace id, email or content',
  // source registry (#478): a global table of external-source policy, no tenant rows to leak
  SOURCE_KINDS: 'constant',
  SOURCE_ACCESS_MODES: 'constant',
  SOURCE_REVIEW_STATUSES: 'constant',
  SOURCE_MAX_TIERS: 'constant',
  SourceNotCleared: 'error class',
  SourceAdminError: 'error class',
  validateSourceTier: 'pure',
  validateSourceInput: 'pure',
  decideSourceClearance: 'pure',
  asSourceStaff: 'pure',
  policyFor:
    'global table `source` (GLOBAL_TABLES, no workspace_id, no RLS): holds platform policy, never tenant data; writes need an enabled ops or admin staff_user',
  isCleared:
    'global table `source` (GLOBAL_TABLES, no workspace_id, no RLS): holds platform policy, never tenant data; writes need an enabled ops or admin staff_user',
  listSources:
    'global table `source` (GLOBAL_TABLES, no workspace_id, no RLS): holds platform policy, never tenant data; writes need an enabled ops or admin staff_user',
  createSource:
    'global table `source` (GLOBAL_TABLES, no workspace_id, no RLS): holds platform policy, never tenant data; writes need an enabled ops or admin staff_user',
  updateSource:
    'global table `source` (GLOBAL_TABLES, no workspace_id, no RLS): holds platform policy, never tenant data; writes need an enabled ops or admin staff_user',
  setSourceKillSwitch:
    'global table `source` (GLOBAL_TABLES, no workspace_id, no RLS): holds platform policy, never tenant data; writes need an enabled ops or admin staff_user',
  // court document network (#485): `findContributed` reads the global `contributed_document` table (no
  // workspace_id, no RLS), whose rows carry no contributor; the ledger linking them is tenant data
  findContributed:
    'global table `contributed_document` (GLOBAL_TABLES, no workspace_id, no RLS): public text only, no contributor field; the tenant link is `contribution_ledger`',
  CONTRIBUTABLE_DOCUMENT_KINDS: 'constant',
  isContributableKind: 'pure',
  ContributionRefused: 'error class',
  recordFetchLog:
    'global table `fetch_log` (GLOBAL_TABLES, no workspace_id, no RLS): content-free log of external fetches (ids, URL hash, status, tier, cost), never tenant data; the app role may only SELECT and INSERT',
  createFetchLogSink:
    'global table `fetch_log` (GLOBAL_TABLES, no workspace_id, no RLS): content-free log of external fetches (ids, URL hash, status, tier, cost), never tenant data; the app role may only SELECT and INSERT',
  // global court-data controls (#486): act on the global `contributed_document` table, never on tenant rows
  expireCourtData:
    'global table `contributed_document` (GLOBAL_TABLES, no workspace_id, no RLS): blanks copies past their source retention; a system job, no tenant input',
  eraseCourtDataSubject:
    'global table `contributed_document` (GLOBAL_TABLES, no workspace_id, no RLS): staff-only (enabled ops or admin staff_user) masking of a person name; no tenant input, the tenant link `contribution_ledger` is untouched',
  courtDataRetention:
    'global table `contributed_document` (GLOBAL_TABLES, no workspace_id, no RLS): system job (system.court-data.retention) with no workspace payload',
  CourtDataErasureError: 'error class',
  MASKED_NAME: 'constant',
  MIN_ERASURE_SUBJECT_LENGTH: 'constant',
  SOURCE_DATA_CLASSES: 'constant',
  exposableThroughApi: 'pure',
  PUBLIC_API_MAX_LIMIT: 'constant',
  PUBLIC_API_DEFAULT_LIMIT: 'constant',
  sourceLicense: 'pure',
  sourceOpsOverview:
    'global tables `source` and `fetch_log` (GLOBAL_TABLES, no workspace_id, no RLS): content-free counts, ids, status, tier and cost, never tenant data',
  sourceFetchLogs:
    'global tables `source` and `fetch_log` (GLOBAL_TABLES, no workspace_id, no RLS): content-free counts, ids, status, tier and cost, never tenant data',
  topFailingSources: 'pure',
  isFetchError: 'pure',
  FRESHNESS_SLA_HOURS: 'constant',
  staffConflictRate:
    'app_staff_conflict_rate() returns per-source counts only and runs only for an enabled staff_user (covered in packages/db/src/__tests__/staff-console-schema.test.ts)',
  staffParseYield:
    'app_staff_parse_yield() returns per-adapter counts only and runs only for an enabled staff_user (covered in packages/db/src/__tests__/staff-console-schema.test.ts)',
  // staff coverage tracker (#517)
  COVERAGE_DATA_TYPES: 'constant',
  COVERAGE_LEVELS: 'constant',
  forumState: 'pure',
  sourceCoversForum: 'pure',
  buildCoverage: 'pure',
  rankGaps: 'pure',
  diffCoverage: 'pure',
  coverageReport: 'pure',
  readCatalogueCoverageInputs:
    'global tables `forum` (system catalogue rows only, `global_read`), `source`, `fetch_log` and `notice` (GLOBAL_TABLES, no RLS): ids, levels, counts and times, never tenant data',
  staffCoverageInputs:
    'app_staff_watch_demand() returns per-source counts only and runs only for an enabled staff_user (covered in packages/db/src/__tests__/staff-console-schema.test.ts)',
  // automation: pure helpers, constants and error classes (#47)
  decideLevel: 'pure (reads only the draft and the context it is given)',
  needsYouReason: 'pure',
  thresholdKey: 'pure',
  idempotencyKey: 'pure (sha256 of its arguments)',
  PROPOSAL_EXPIRY_DAYS: 'constant',
  KindNotEnabled: 'error class',
  SensitiveAiRefusedError: 'error class',
  UndoExpiredError: 'error class',
  UndoRefusedError: 'error class',
  ACTIVITY_EXPORT_FIELDS: 'constant',
  ACTIVITY_PAGE_SIZE: 'constant',
  CLERK_ACTIVITY_KINDS: 'constant',
  buildHandlerRegistry: 'pure (checks handler kinds; touches no data)',
  FORBIDDEN_KIND_PATTERN: 'constant',
  HANDLERS: 'constant (handler registry; handlers run only inside an engine call)',
  HandlerRegistrationError: 'error class',
  AUTOMATION_LEVELS: 'constant',
  fromNumericLevel: 'pure',
  isAutomationLevel: 'pure',
  toNumericLevel: 'pure',
  UNDO_WINDOW_DAYS: 'constant',
  APPROVAL_MATRIX: 'constant (the approval matrix as data)',
  THRESHOLD_CAP: 'constant',
  THRESHOLD_STEP: 'constant',
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
  // court: deep links (#34)
  resolveDeepLink: 'pure',
  buildDeepLink: 'pure',
  interpolateTemplate: 'pure',
  // court: roster-PDF preview (#385)
  previewRosterImport: 'pure (parses supplied PDF bytes; reads and writes no tenant data)',
  normaliseJudgeName: 'pure',
  // court: bench-change alerts (#389)
  portfolioRuleMatches: 'pure (matches a portfolio rule against a case type and year)',
  classifyBenchNotice: 'pure (reads a notice title; no data access)',
  BENCH_NOTICE_TYPES: 'constant',
  BENCH_NOTICE_WINDOW_DAYS: 'constant',
  benchChangeDay: 'pure (formats an ISO date as "05 Oct")',
  benchChangeTitle: 'pure (the counts-only notification title)',
  // court: roster lookup statements (#387), exported for the plan and budget test
  rosterAtStatement:
    'pure SQL builder; getRosterAt runs it inside withWorkspace on the given workspace',
  benchForHallStatement:
    'pure SQL builder; resolveBenchForHall runs it inside withWorkspace on the given workspace',
  // court: read-model statements (#427), exported for the plan and budget test
  listForumsStatement:
    'pure SQL builder; listForums runs it inside withWorkspace on the given workspace',
  getForumStatement:
    'pure SQL builder; getForum runs it inside withWorkspace on the given workspace',
  latestParseRunsStatement:
    'pure SQL builder; getCourtsIndex runs it inside withWorkspace on the given workspace',
  hallsSeenStatement:
    'pure SQL builder; listHallsSeen runs it inside withWorkspace on the given workspace',
  // court: rosters page statements (#434), exported for the budget test
  rostersPageRostersStatement:
    'pure SQL builder; getRostersPage runs it inside withWorkspace after the membership check',
  rosterEntryCountsStatement:
    'pure SQL builder; getRostersPage runs it inside withWorkspace after the membership check',
  openBenchAlertsStatement:
    'pure SQL builder; getRostersPage runs it inside withWorkspace with the resolved actor',
  // matter graph (#362): errors and pure proceeding-identity helpers
  CrossWorkspaceError: 'error class',
  crossWorkspace: 'error factory',
  graphNotFound: 'error factory',
  normaliseCaseType: 'pure',
  normaliseCaseNumber: 'pure',
  expandYear: 'pure',
  identityKey: 'pure',
  isSameProceeding: 'pure',
  // proceeding state machine (#363): the error and the pure transition table
  InvalidTransitionError: 'error class',
  assertTransition: 'pure',
  PROCEEDING_TRANSITIONS: 'constant',
  // matter graph (#41): the collapse threshold and the anchor cap
  GRAPH_GROUP_THRESHOLD: 'constant',
  TIMELINE_ANCHORS_MAX: 'constant',
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
  // privacy settings (#286)
  PRIVACY_SETTING_FIELDS: 'constant',
  DEFAULT_PRIVACY_SETTINGS: 'constant',
  // integration tokens (#287)
  INTEGRATION_KINDS: 'constant',
  generateIntegrationToken: 'pure (random bytes)',
  hashIntegrationToken: 'pure',
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
  // court: KHC cause-list watch (#482)
  KHC_CAUSE_LIST_SOURCE_ID: 'constant',
  COURT_KHC_A2_FLAG: 'constant',
  KHC_LIST_PATHS: 'constant',
  PUBLICATION_REF_PREFIX: 'constant',
  createKhcListParser: 'pure (builds the KHC adapter parser; no database access)',
  getPublicationForRef:
    'global table `cause_list_publication` (GLOBAL_TABLES, no workspace_id, no RLS): content-free list publication metadata (URL, fetch time, hash), never tenant data',
  pollCauseList:
    'system job body: no workspace; reads watches only through the owner-defined app_cause_list_watch_targets and writes proposals under each watching workspace scope; covered by list-watch.test.ts',
  CAUSELIST_POLL_CRON: 'constant',
  causelistPoll: 'job definition (handler is runCauselistPoll)',
  runCauselistPoll: 'system job body: see pollCauseList',
  // court day: display-board tracking and the call-time estimate (#493)
  COURT_LIVE_TRACKING_FLAG: 'constant',
  BENCH_FACTS_FLAG: 'constant',
  BOARD_SOURCES: 'constant',
  DEFAULT_AWAY_THRESHOLDS: 'constant',
  isCourtHours: 'pure (clock arithmetic in IST)',
  planBoardAlert: 'pure (decides the one alert a listed item earns from a board row)',
  pollBoards:
    'system job body: no workspace; reads halls only through the owner-defined app_board_poll_targets, writes the global content-free board_observation and notifies each matter owner in their own workspace scope; covered by court-day/board.test.ts',
  itemNumber: 'pure',
  paceSamples: 'pure',
  estimateCallWindow: 'pure',
  backtestEta: 'pure',
  BOARD_POLL_CRON: 'constant',
  boardPoll: 'job definition (handler is runBoardPoll)',
  runBoardPoll: 'system job body: see pollBoards',
  setBoardFetcherFactory: 'wiring point for the governed fetcher (worker startup)',
  // notices: the official notices feed (#586)
  NOTICE_PARSERS: 'constant',
  pollNotices:
    'system job body: no workspace; fetches only cleared global notice sources and writes the global notice table (GLOBAL_TABLES, no tenant data); covered by notices.test.ts',
  NOTICES_POLL_CRON: 'constant',
  NOTICES_LIST_LIMIT: 'constant',
  noticesPoll: 'job definition (handler is runNoticesPoll)',
  runNoticesPoll: 'system job body: see pollNotices',
  setNoticeFetcherFactory: 'wiring setter for the governed fetcher: no database access',
  // case-watch: delegated status lookups (#591)
  STATUS_SOURCES: 'constant',
  hashStatusFields: 'pure',
  diffStatus: 'pure',
  hasChanges: 'pure',
  statusChangeDraft: 'pure (builds a draft; submitting it goes through submitProposals)',
  runCaseStatusLookup:
    "actor-scoped in withWorkspace: loads only the actor's own watch (advocate_user_id = actor) and proceeds as delegatedFor that advocate on that matter; another advocate or workspace gets NOT_FOUND before any fetch; covered by case-watch.test.ts",
  recordDeviceSnapshot:
    "actor-scoped in withWorkspace: stores a snapshot only on the actor's own watch; covered by case-watch.test.ts",
  // case-watch: the status poll and change alerts (#592)
  MAX_PER_ADVOCATE_PER_RUN: 'constant',
  MAX_PER_SOURCE_PER_RUN: 'constant',
  MAX_WATCHES_PER_RUN: 'constant',
  pollCaseWatches:
    "system job body: no workspace; lists due watches only through the owner-defined app_case_watch_due and runs each as the watch's own advocate through runCaseStatusLookup (own watch only, delegatedFor); covered by status-poll.test.ts",
  touchWatchPolled:
    "actor-scoped in withWorkspace: updates last_polled_at only on the actor's own watch; covered by status-poll.test.ts",
  notifyStatusChanges:
    "actor-scoped in withWorkspace: reads the matter under the actor's workspace and notifies only the actor; covered by status-poll.test.ts",
  STATUS_POLL_CRON: 'constant',
  statusPoll: 'job definition (handler is runStatusPoll)',
  runStatusPoll: 'system job body: see pollCaseWatches',
  setStatusFetcherFactory: 'setter (worker wires the governed fetcher, #592)',
  // deadlines (#494, D-048): court calendars and calendar-aware due dates
  closedReason: 'pure',
  computeDueDate: 'pure',
  DEFAULT_WEEKLY_OFFS: 'constant',
  FORUM_VACATIONS: 'constant',
  deadlineForDirection: 'reads only the calendar of the given workspace (loadCourtCalendar)',
  applyDeadlineRules:
    'pure over its directions plus the given workspace calendar (loadCourtCalendar)',
  // case-watch: the orders poll (#494)
  MAX_ORDERS_PER_WATCH_PER_RUN: 'constant',
  ORDERS_POLL_CRON: 'constant',
  ordersPoll: 'job definition (handler is runOrdersPoll)',
  runOrdersPoll: 'system job body: see pollOrders',
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
  supportRequestCopy: 'pure (owner notice copy)',
  supportRequestDedupeKey: 'pure',
  SupportSessionInactiveError: 'error class',
  STAFF_SUPPORT_LIST_LIMIT: 'constant',
  supportSessionState: 'pure (session state at a time)',
  // platform staff accounts (#309)
  STAFF_ROLES: 'constant',
  DEV_STAFF_EMAIL: 'constant',
  StaffAdminError: 'error class',
  STAFF_WORKSPACE_FIELDS: 'constant (staff console field list)',
  STAFF_AUDIT_FIELDS: 'constant (staff console field list)',
  STAFF_USAGE_COUNTER_FIELDS: 'constant (staff console field list)',
  STAFF_BUDGET_OVERRIDE_FIELDS: 'constant (staff console field list)',
  withOwnerDb: 'connection helper (owner-role handle for the operator CLI); reads nothing itself',
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
  // jobs: end-of-day digest definitions and schemas (#49)
  // news digest (#481): news_item is a global table of public feed fields, no tenant rows
  NEWS_PRACTICE_AREAS: 'constant',
  NEWS_FORUMS: 'constant',
  DEFAULT_NEWS_DIGEST_TIME: 'constant',
  NEWS_DIGEST_MAX_ITEMS: 'constant',
  NewsError: 'error class',
  isNewsDigestTime: 'pure predicate',
  newsMatchScore: 'pure ranking function over in-memory items',
  rankNewsItems: 'pure ranking function over in-memory items',
  upsertNewsItems: 'writes the global news_item table (public feed fields), no tenant rows',
  listNewsSourceIds: 'reads the global source registry, no tenant rows',
  newsDigest: 'job definition (handler is runNewsDigest)',
  newsDigestMember: 'job definition (handler is runNewsDigestMember)',
  newsDigestSchedule: 'job definition (handler is runNewsDigestSchedule)',
  newsDigestSchema: 'zod schema',
  newsDigestMemberSchema: 'zod schema',
  newsDigestSlot: 'pure function of a clock and a zone',
  newsPoll: 'job definition (handler is runNewsPoll)',
  systemNewsPoll: 'job definition (handler is runNewsPollSchedule)',
  newsPollSchema: 'zod schema',
  runNewsPoll: 'system job: fetches one global source and writes the global news_item table',
  runNewsPollSchedule: 'system job: lists cleared global sources only',
  setNewsFetcherFactory: 'wiring setter for the governed fetcher: no database access',
  activityDigest: 'job definition (handler is runActivityDigest)',
  activityDigestMember: 'job definition (handler is runActivityDigestMember)',
  activityDigestSchedule: 'job definition (handler is runActivityDigestSchedule)',
  activityDigestSchema: 'zod schema',
  activityDigestMemberSchema: 'zod schema',
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
  // change webhooks (#626)
  MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE: 'constant',
  MAX_WEBHOOK_URL_LENGTH: 'constant',
  WEBHOOK_DISABLE_AFTER_FAILURES: 'constant',
  WEBHOOK_HEADERS: 'constant',
  WEBHOOK_RETRY_LIMIT: 'constant',
  WEBHOOK_SWEEP_CRON: 'constant',
  WebhookError: 'error class',
  generateWebhookSecret: 'pure (random secret)',
  signWebhook: 'pure (HMAC-SHA256)',
  verifyWebhookSignature: 'pure (HMAC-SHA256, constant time)',
  webhookDeliver: 'job definition (handler is runWebhookDeliver)',
  runWebhookDeliver:
    'job body: re-reads the delivery and its endpoint inside the payload workspace scope',
  webhookDeliverSchema: 'job payload schema',
  systemWebhookSweep: 'job definition (handler is runWebhookSweep)',
  runWebhookSweep: 'system job body: lists ids through app_webhook_delivery_due and enqueues',
  setCauseListFetcherFactory: 'setter (worker wires the governed fetcher, #482)',
  // public API keys (#624)
  API_KEY_SCOPES: 'constant',
  API_CALLS_USAGE_KEY: 'constant',
  API_KEY_TOKEN_PATTERN: 'constant',
  DEFAULT_API_KEY_RATE_LIMIT_PER_MINUTE: 'constant',
  ApiKeyError: 'error class',
  isApiKeyScope: 'pure',
  hashApiKeyToken: 'pure (sha256)',
  generateApiKeyToken: 'pure (random token)',
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
  // lifecycle: workspace deletion constants, receipt and errors (#302)
  DELETION_COOLOFF_MS: 'constant',
  ACTIVE_DELETION_STATUSES: 'constant',
  DeletionError: 'error class',
  deletionNoticeCopy: 'pure (notice copy)',
  ERASE_STEPS: 'constant',
  FINALIZE_TABLES: 'constant (documented finalize-step tables)',
  PURGE_BATCH: 'constant',
  PURGE_ORDER: 'constant (purge order)',
  purgeCoverage: 'pure (purge lists vs tenant tables)',
  LEGAL_HOLD_RULE: 'constant (documented legal-hold rule)',
  LEGAL_HOLD_STATUSES: 'constant',
  LEGAL_HOLD_YEARS: 'constant',
  legalHoldRetainUntil: 'pure (date arithmetic)',
  retainInvoicesForLegalHold:
    "internal erase helper: runs on the caller's transaction, which runWorkspaceErase pins to the payload workspace (RLS limits the read); covered by the runWorkspaceErase case",
  buildDeletionReceipt: 'pure (builds and signs a receipt)',
  canonicalJson: 'pure',
  DELETION_RECEIPT_VERSION: 'constant',
  receiptHash: 'pure (sha256)',
  receiptWorkspaceIdHash: 'pure (sha256)',
  verifyDeletionReceipt: 'pure (HMAC check)',
  // lifecycle: account deletion and memory erasure constants (#303)
  ACCOUNT_DELETION_ERRORS: 'constant',
  ACCOUNT_DELETION_SOLE_OWNER_MESSAGE: 'constant',
  ACCOUNT_DELETION_STAFF_MESSAGE: 'constant',
  MEMORY_ERASE_BATCH: 'constant',
  MEMORY_ERASE_PRIORITY: 'constant',
  MEMORY_ERASURE_SLA_MS: 'constant',
  MEMORY_TABLES: 'constant',
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
  setBenchAlertPartyNames: notificationDenies,
  setCourtHoursQuiet: notificationDenies,
  getDigest: notificationDenies,
  setDigest: notificationDenies,
  // End-of-day digest preference (#49)
  getEndOfDayPreference: notificationDenies,
  setEndOfDayPreference: notificationDenies,
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
  // End-of-day digest (#49): pure builders and schedule maths, no database access
  buildEndOfDayDigest: 'pure (builds the digest payload from counts)',
  DEFAULT_END_OF_DAY_TIME: 'constant',
  END_OF_DAY_ZONE: 'constant',
  endOfDaySlot: 'pure (time zone math)',
  isDigestTimeOfDay: 'pure',
  localDateOf: 'pure (time zone math)',
  localDayBounds: 'pure (time zone math)',
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
  inWorkspaceOn: {
    test: CORE_RUNTIME_TEST,
    kind: 'caller-checked',
    note: "inWorkspace on an injected handle; the api's requireWorkspace checks membership first",
  },
  memberRoleFor: runtimeEmpty,
  ownerGraceFor: runtimeEmpty,
  resolveIntakeAddressFor: {
    test: CORE_RUNTIME_TEST,
    kind: 'caller-checked',
    note: 'looks an inbound address up on the app db with no workspace scope (the sender is not a member); only an active address resolves, unknown and revoked ones are the same null',
  },
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
  // automation activity feed and undo (#49)
  listActivitiesFor: runtimeDenies,
  getActivityDetailFor: runtimeDenies,
  countActivitiesByDayFor: runtimeDenies,
  previewUndoFor: runtimeDenies,
  undoActivityFor: runtimeDenies,
  undoCaptureFor: runtimeDenies,
  reassignCaptureFor: runtimeDenies,
  exportActivitiesFor: runtimeDenies,
  recordAccessDeniedFor: {
    test: CORE_RUNTIME_TEST,
    kind: 'caller-checked',
    note: "recordAccessDenied on the app db; guard sets member from memberRoleFor, a non-member's denial never lands in that workspace chain",
  },
  // support sessions (#313)
  loadSupportPage: runtimeScopeChecked,
  activeSupportSessionIn: runtimeScopeChecked,
  requestSupportSessionFor: runtimeDenies,
  grantSupportSessionFor: runtimeDenies,
  denySupportSessionFor: runtimeDenies,
  revokeSupportSessionFor: runtimeDenies,
  // support sessions, staff side (#314)
  listStaffSupportSessionsFor: runtimeSelfScoped,
  staffSupportSessionFor: runtimeSelfScoped,
  supportWorkspaceViewFor: runtimeDenies,
  recordAccountProfileUpdatedFor: {
    test: CORE_RUNTIME_TEST,
    kind: 'self-scoped',
    note: "account-level audit row (workspaceId null) for the caller's own profile; never lands in a workspace chain",
  },
  requestExportFor: runtimeDenies,
  issueExportDownloadFor: runtimeDenies,
  openExportDownloadFor: runtimeDenies,
  listExportJobsFor: runtimeEmpty,
  requestWorkspaceDeletionFor: runtimeDenies,
  cancelWorkspaceDeletionFor: runtimeDenies,
  activeWorkspaceDeletionIn: runtimeEmpty,
  requestAccountDeletionFor: {
    test: CORE_RUNTIME_TEST,
    kind: 'self-scoped',
    note: "requestAccountDeletion for the caller's own account; never writes into a workspace chain",
  },
  requestMemoryErasureFor: runtimeDenies,
  // court rosters (#434)
  previewRosterImportFor: runtimeDenies,
  confirmRosterImportFor: runtimeDenies,
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
  closeAppDb: 'closes the app-role pool on shutdown; reads no rows',
  createIdempotencyStore:
    'api_idempotency_key is a global table keyed by (user, key) (GLOBAL_TABLES); every query filters by the caller user id',
  IDEMPOTENCY_TTL_MS: 'constant',
  IN_PROGRESS_STATUS: 'constant',
  uploadContext:
    'pure (binds the app db into a StorageCtx; the uploads route checks membership and authorize gates each storage call)',
  captureContext:
    'pure (binds the app db, env config and job producer into a CaptureCtx; capture routes check membership and authorize gates each capture call, covered by packages/core/src/capture/__tests__/cross-tenant.test.ts)',
};

/**
 * Tracked-case metering (#664) lives in the `@causedeck/core/billing` subpath, which the root
 * index does not re-export, so the root registry above never sees it. These entries are checked
 * for staleness against that subpath's exports and for an existing test file.
 */
export const BILLING_SERVICE_TESTS: Readonly<Record<string, ServiceEntry>> = {
  countTrackedCases: {
    test: CORE_SERVICES_TEST,
    kind: 'rls-empty',
    note: 'counts portfolio_case rows for the given workspace id on the caller transaction; RLS hides other workspaces rows',
  },
  getTrackedCaseCharge: {
    test: CORE_SERVICES_TEST,
    kind: 'rls-empty',
    note: 'reads the entitlement row and portfolio_case count for the given workspace id on the caller transaction; naming another workspace reads nothing and charges 0',
  },
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
      ...Object.values(BILLING_SERVICE_TESTS).map((entry) => entry.test),
      STORAGE_PRESIGN_TEST,
    ]),
  ].sort();
}
