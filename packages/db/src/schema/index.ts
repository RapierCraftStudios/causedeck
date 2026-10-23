// Every table and enum drizzle-kit migrates. Later issues add their tables here.
export * from './enums.ts';
export { adapterHealthSummary, adapterParseRun, adapterVersion } from './adapters.ts';
export {
  aiCall,
  aiCallResult,
  auditActorKind,
  auditActorSalt,
  auditEvent,
  auditOutcome,
} from './audit.ts';
export { apiIdempotencyKey, type StoredApiResponse } from './api-idempotency.ts';
export { billingEvent, entitlement, plan, subscription, usageCounter } from './billing.ts';
export {
  CAPTURE_CHANNELS,
  CAPTURE_SCAN_STATUSES,
  CAPTURE_STATUSES,
  capture,
  workspaceCaptureChannel,
  type CaptureChannel,
  type CaptureRow,
  type CaptureScanStatus,
  type CaptureStatus,
} from './capture.ts';
export { catalogueMeta } from './catalogue-meta.ts';
export {
  account,
  invitation,
  member,
  organization,
  passkey,
  rateLimit,
  session,
  twoFactor,
  user,
  verification,
} from './auth.ts';
export {
  ACCESS_MODE_NAMES,
  accessMode,
  accessModeRegistry,
  FLAG_CHANGE_REQUEST_STATUSES,
  featureFlag,
  flagChangeRequest,
  workspaceFeatureFlag,
  type FlagChangeRequestStatus,
} from './flags.ts';
export { bench, courtHall, forum, type ForumLanguageProfile } from './court.ts';
export {
  ANCHOR_KINDS,
  ANCHOR_QUOTE_MAX,
  anchor,
  document,
  documentPage,
  type AnchorBbox,
  type AnchorKind,
  type AnchorTranscriptSpan,
} from './documents.ts';
export {
  ACTIVITY_ACTORS,
  activity,
  AUTOMATION_LEVELS,
  automationPreference,
  automationThreshold,
  PROPOSAL_STATUSES,
  proposal,
  type ActivityActor,
  type AutomationLevelValue,
  type ProposalStatus,
} from './automation.ts';
export { jobEffect } from './job-effect.ts';
export {
  DELETION_KINDS,
  DELETION_STATUSES,
  deletionJob,
  deletionTombstone,
  EXPORT_SCOPES,
  EXPORT_STATUSES,
  exportJob,
  type DeletionKind,
  type DeletionStatus,
  type ExportScope,
  type ExportStatus,
} from './lifecycle.ts';
export { legalHoldInvoice } from './legal-hold.ts';
export { MATTER_STATUSES, matter, type MatterStatus } from './matter-graph.ts';
export { matterRestriction } from './matter-restriction.ts';
export { organisation, person, roleEdge, type PersonContact } from './people.ts';
export {
  CNR_PATTERN,
  PROCEEDING_LINK_KINDS,
  proceeding,
  proceedingLink,
  proceedingStateChange,
  type ProceedingLinkKind,
} from './proceedings.ts';
export {
  OBLIGATION_CLOSED_REASON_TYPES,
  TASK_STATUSES,
  appearance,
  hearing,
  listing,
  obligation,
  order,
  task,
  type ObligationClosedReasonType,
  type OperativeDirection,
  type TaskStatus,
} from './docket.ts';
export {
  BENCH_CHANGE_ALERT_STATUSES,
  BENCH_CHANGE_REASONS,
  BENCH_ROSTER_STATUSES,
  benchChangeAlert,
  benchRoster,
  benchRosterEntry,
  type BenchChangeAlertStatus,
  type BenchChangeReason,
  type BenchRosterStatus,
  type PortfolioRule,
} from './roster.ts';
export {
  emailSuppression,
  notification,
  notificationChannel,
  notificationDigest,
  notificationPref,
  notificationSetting,
  pushSubscription,
} from './notifications.ts';
export {
  invoiceCounter,
  SAAS_INVOICE_STATUSES,
  saasInvoice,
  saasInvoiceLine,
  type SaasInvoiceParty,
  type SaasInvoiceStatus,
} from './saas-invoice.ts';
export {
  STAFF_ROLES,
  staffRole,
  staffUser,
  SUPPORT_SESSION_MAX_MINUTES,
  SUPPORT_SESSION_SCOPES,
  SUPPORT_SESSION_STATUSES,
  supportSession,
  supportSessionScope,
  supportSessionStatus,
  type StaffRole,
  type SupportSessionScope,
  type SupportSessionStatus,
} from './staff.ts';
export { BLOB_SCAN_STATUSES, blob, workspaceKey, type BlobScanStatus } from './storage.ts';
export { budgetOverride, usageEvent, usagePeriodSummary, usageReservation } from './usage.ts';
export { workspaceSettings, workspaceSlugHistory } from './workspace.ts';
export { schemaInfo } from './_meta.ts';
export {
  ICS_FEED_SCOPES,
  ICS_IMPORT_STATUSES,
  icsFeed,
  icsFeedEvent,
  icsImportEvent,
  type IcsFeedScope,
  type IcsFeedSnapshot,
  type IcsImportStatus,
} from './ics.ts';
export {
  INTEGRATION_KINDS,
  workspaceIntegration,
  type IntegrationKind,
} from './workspace-integration.ts';
export {
  INTAKE_ADDRESS_STATUSES,
  INTAKE_ALLOWLIST_KINDS,
  INTAKE_MESSAGE_STATUSES,
  intakeAddress,
  intakeAllowlist,
  intakeMessage,
  type IntakeAddressStatus,
  type IntakeAllowlistKind,
  type IntakeMessageStatus,
} from './email-intake.ts';
export { EXTRACTION_STATUSES, extraction, type ExtractionStatus } from './extraction.ts';
