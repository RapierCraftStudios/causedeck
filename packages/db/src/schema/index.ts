// Every table and enum drizzle-kit migrates. Later issues add their tables here.
export * from './enums.ts';
export {
  ACTIVATION_CHANNELS,
  ACTIVATION_STEPS,
  activationEvent,
  type ActivationChannel,
  type ActivationStep,
} from './activation.ts';
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
export { apiKey } from './api-keys.ts';
export {
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_EVENT_TYPES,
  webhookDelivery,
  webhookEndpoint,
  type WebhookDeliveryStatus,
  type WebhookEventType,
} from './webhooks.ts';
export { portfolio, portfolioCase, portfolioPanelAdvocate } from './portfolio.ts';
export {
  migrationRun,
  migrationRunRow,
  provisioningRun,
  scimToken,
  ssoProvider,
} from './enterprise.ts';
export {
  WHATSAPP_E164_PATTERN,
  WHATSAPP_OTP_MAX_ATTEMPTS,
  WHATSAPP_INBOUND_STATUSES,
  whatsappInboundMessage,
  whatsappLink,
  whatsappOtpChallenge,
} from './whatsapp-link.ts';
export {
  CERTIFIED_COPY_STATUSES,
  OBLIGATION_EVENT_KINDS,
  certifiedCopy,
  defect,
  obligationEvent,
  type CertifiedCopyStatus,
  type ObligationEventKind,
} from './obligation-tracking.ts';
export { correction, CORRECTION_COLUMNS, type CorrectionColumn } from './correction.ts';
export {
  OUTWARD_AUDIENCES,
  OUTWARD_DRAFT_STATUSES,
  OUTWARD_LANGUAGES,
  OUTWARD_SHARE_CHANNELS,
  OUTWARD_TONES,
  outwardDraft,
  outwardDraftVersion,
  outwardShareLog,
  type OutwardAudience,
  type OutwardDraftStatus,
  type OutwardFact,
  type OutwardLanguage,
  type OutwardShareChannel,
  type OutwardTone,
} from './outward-draft.ts';
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
export { fetchLog } from './fetch-log.ts';
export { judgment, type JudgmentPageText, type JudgmentProvenance } from './corpus.ts';
export {
  NEWS_EXCERPT_MAX,
  NEWS_FORUMS,
  NEWS_PRACTICE_AREAS,
  newsItem,
  newsPref,
  type NewsForum,
  type NewsPracticeArea,
  type NewsTags,
} from './news.ts';
export {
  DATA_OPS_ALERT_STATUSES,
  DATA_OPS_ALERT_TYPES,
  SOURCE_HEALTH_STATES,
  dataOpsAlert,
  dataOpsAlertStatus,
  dataOpsAlertType,
  dataOpsOncall,
  sourceHealth,
  sourceHealthState,
  sourceParseRun,
  type DataOpsAlertStatus,
  type DataOpsAlertType,
  type SourceHealthState,
} from './data-ops.ts';
export {
  NO_CAPTCHA_KINDS,
  SOURCE_ACCESS_MODES,
  SOURCE_DATA_CLASSES,
  SOURCE_KINDS,
  SOURCE_MAX_TIERS,
  SOURCE_REVIEW_STATUSES,
  source,
  sourceAccessMode,
  sourceKind,
  sourceMaxTier,
  sourceReviewStatus,
  type SourceAccessMode,
  type SourceDataClass,
  type SourceKind,
  type SourceMaxTier,
  type SourceReviewStatus,
} from './source-registry.ts';
export {
  CONTRIBUTABLE_KINDS,
  contributedDocument,
  contributionLedger,
  type ContributableKind,
} from './network.ts';
export { bench, courtHall, forum, type ForumLanguageProfile } from './court.ts';
export {
  DRAFT_EXPORT_FORMATS,
  DRAFT_FACT_ACK_KINDS,
  DRAFT_STATUSES,
  draft,
  draftConsistencyReport,
  draftExport,
  draftFactAck,
  draftVersion,
  template,
  type DraftExportFormat,
  type DraftFactAckKind,
  type DraftStatus,
  type DraftingBlocks,
} from './drafting.ts';
export { AUTHORITY_KINDS, AUTHORITY_STATUSES, authority } from './authority.ts';
export {
  PRECEDENT_PASSAGE_KINDS,
  PRECEDENT_PASSAGE_STATUSES,
  precedentPassage,
  type PrecedentPassageStatus,
} from './precedent.ts';
export {
  ANCHOR_KINDS,
  ANCHOR_QUOTE_MAX,
  anchor,
  document,
  documentPage,
  type AnchorBbox,
  type AnchorKind,
  type AnchorTranscriptSpan,
  type OcrLine,
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
export { advocateProfile } from './advocate-profile.ts';
export {
  BOARD_OBSERVATION_STATUSES,
  boardObservation,
  type BoardObservationStatus,
} from './display-board.ts';
export { benchSittingFact } from './bench-facts.ts';
export {
  CAUSE_LIST_WATCH_KINDS,
  causeListPublication,
  causeListWatch,
  type CauseListWatchKind,
} from './cause-list-watch.ts';
export {
  IMPORT_BATCH_FILE_STATUSES,
  IMPORT_BATCH_STATUSES,
  importBatch,
  importBatchFile,
  importPlan,
  type ImportBatchFileStatus,
  type ImportBatchStatus,
} from './import-batch.ts';
export {
  NOTICE_KINDS,
  NOTICE_MATCH_REASONS,
  notice,
  noticeHoliday,
  noticeKind,
  noticeMatch,
  type NoticeKind,
  type NoticeMatchReason,
} from './notices.ts';
export {
  CASE_STATUS_VIA,
  caseStatusSnapshot,
  caseWatch,
  type CaseStatusVia,
} from './case-watch.ts';
export {
  ISSUE_TAG_SOURCES,
  ISSUE_TAG_STATUSES,
  judgmentAlert,
  matterIssueTag,
  type IssueTagSource,
  type IssueTagStatus,
} from './matter-issue.ts';
export { researchNote, researchProvider, type ResearchAuthority } from './research-note.ts';
export { courtDayMarker, listSnapshot, type ListSnapshotRow } from './court-day.ts';
export {
  REVIEW_FIELDS,
  REVIEW_KINDS,
  REVIEW_STATUSES,
  reviewCorrection,
  reviewItem,
  type ReviewField,
  type ReviewKind,
  type ReviewStatus,
} from './review.ts';
export {
  MEMORY_ITEM_STATUSES,
  MEMORY_LAYERS,
  MEMORY_PROPOSAL_STATUS_VALUES,
  MEMORY_SCOPE_VALUES,
  MEMORY_USAGE_PURPOSES,
  memoryEmbedding,
  memoryItem,
  memoryPause,
  memoryProposal,
  memoryUsage,
  type MemoryItemStatus,
  type MemoryLayerValue,
  type MemoryProposalStatusValue,
  type MemoryScopeValue,
  type MemoryUsagePurpose,
} from './memory.ts';
export { briefState, type BriefCarryEntry } from './brief.ts';
export { clientContact } from './client-contact.ts';
export { conflictCheckResult, enquiry, enquiryParty } from './enquiry.ts';
export { handoverNote, matterView } from './continuity.ts';
export { clientLedgerEntry, feeAgreement, feeInvoice, feeInvoiceLine, payment } from './fees.ts';
export { briefShare, referral, referralCredit, type SharedBriefSnapshot } from './share.ts';
export { reminderDispatch, REMINDER_KINDS, type ReminderKind } from './reminder.ts';
export { attentionSnooze, ATTENTION_SNOOZE_RULES, type AttentionSnoozeRule } from './attention.ts';
