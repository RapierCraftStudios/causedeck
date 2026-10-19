// Audit log (#26): the `record()` writer, action registry, privacy guards, chain verification, the
// default offboarding sink and the `ai_call` writer contract. See docs/engineering/audit.md.
export {
  AiCallContractError,
  recordAiCall,
  type AiCallInput,
  type AiCallSource,
  type AutomationLevel,
} from './ai-call.ts';
export { verifyChain, type ChainRange, type ChainVerification } from './chain.ts';
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
export { recordAuditSink } from './sink.ts';
export { record } from './writer.ts';
