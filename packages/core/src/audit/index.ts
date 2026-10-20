// Audit log (#26): the `record()` writer, action registry, privacy guards, chain verification, the
// default offboarding sink, the `ai_call` writer contract, the feed query and export (#229) and the
// security event emitters (#228). See docs/engineering/audit.md.
export {
  AiCallContractError,
  recordAiCall,
  type AiCallInput,
  type AiCallSource,
  type AutomationLevel,
} from './ai-call.ts';
export { verifyChain, type ChainRange, type ChainVerification } from './chain.ts';
export {
  AUDIT_EXPORT_COLUMNS,
  exportAudit,
  type AuditExportContext,
  type AuditExportFormat,
  type AuditExportOptions,
} from './export.ts';
export {
  AUDIT_ACTIONS,
  isAuditAction,
  isSecurityAction,
  type AuditAction,
  type AuditActionSpec,
  type AuditActorKind,
  type AuditContext,
  type AuditEventInput,
  type AuditMetadataValue,
  type AuditOutcome,
} from './events.ts';
export {
  assertRedacted,
  AUDIT_BANNED_METADATA_KEYS,
  AuditRedactionError,
  hashUserAgent,
  truncateIpForDisplay,
} from './redact.ts';
export {
  authorizeAuditRead,
  queryAudit,
  type AuditEventView,
  type AuditPage,
  type AuditQueryFilters,
  type AuditReadContext,
} from './query.ts';
export {
  createSecurityEventRecorder,
  flagChangeAuditSink,
  hashEmail,
  recordAccessDenied,
  recordExportRun,
  recordFlagChanged,
  recordRoleChanged,
  recordSupportSessionEnded,
  recordSupportSessionStarted,
  recordSupportView,
  type AccessDeniedEvent,
  type ExportRunEvent,
  type FlagChangedEvent,
  type RoleChangedEvent,
  type SupportSessionEvent,
  type SupportViewEvent,
} from './security-events.ts';
export { recordAuditSink } from './sink.ts';
export { record } from './writer.ts';
