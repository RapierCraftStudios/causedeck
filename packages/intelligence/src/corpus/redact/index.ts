// The corpus redaction pipeline (#892, D-053).
export { REDACTION_VERSION } from './version.ts';
export {
  extractCaseTitle,
  redactJudgment,
  type RedactInput,
  type RedactionResult,
} from './redact.ts';
export {
  findLowConfidenceSpans,
  redactWithResolver,
  resolverReplySchema,
  type LowConfidenceResolver,
  type LowConfidenceSpan,
  type ResolverReply,
} from './gateway.ts';
export { detectSensitiveCategory, SENSITIVE_CATEGORIES, type SensitiveCategory } from './sensitive.ts';
export type { PersonRole } from './roles.ts';
