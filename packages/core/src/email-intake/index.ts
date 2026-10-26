// The email-intake domain (#54 part 2; parent #54): the per-user intake address (create, rotate,
// revoke, resolve without an oracle), the sender allow-list, and enabling the `email` capture
// channel with its disclosure. Parsing and trust of the inbound message are #528; the inbound
// webhook (receive.ts), `email.intake` body (run.ts) and raw-MIME retention are #530. Not re-exported from the package root.
export {
  createAddress,
  generateLocalPart,
  getActiveAddress,
  isIntakeLocalPart,
  resolveAddress,
  revokeAddress,
  rotateAddress,
  type IntakeAddressView,
  type ResolvedAddress,
} from './address.ts';
export {
  addAllowlistEntry,
  ALLOWLIST_KINDS,
  listAllowlist,
  MAX_ALLOWLIST_LABEL_LENGTH,
  normalizePattern,
  removeAllowlistEntry,
  type AddAllowlistEntryInput,
  type AllowlistEntry,
} from './allowlist.ts';
export { EMAIL_CHANNEL_DISCLOSURE, enableEmailChannel } from './channel.ts';
export type { EmailIntakeAction, EmailIntakeCtx } from './context.ts';
export { inboundProviderFromProcess, type InboundEmailProvider } from './provider.ts';
export {
  receiveInboundEmail,
  type InboundEmailInput,
  type InboundEmailOutcome,
  type InboundEmailTarget,
} from './receive.ts';
export { RAW_MIME_BATCH, sweepExpiredRawMime } from './retention.ts';
export {
  runEmailIntake,
  type EmailIntakeDeps,
  type EmailIntakeOutcome,
  type EmailIntakePayload,
} from './run.ts';
