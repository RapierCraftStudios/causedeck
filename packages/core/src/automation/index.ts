// The automation domain (#47, ADR 0023): the L1-L4 ladder, the approval matrix as data, proposals
// that change nothing until accepted, auto-applied internal changes with a 7-day cascading undo,
// the per-user "ask me first" dial and threshold learning. Every source hands it `ProposalDraft`s
// (`@causedeck/validators/proposal-draft`); this is the only place "the system acted" is decided.
// There is no send, file, pay, advise, accept-engagement or citation action and no fifth level.
export { decideLevel, needsYouReason, thresholdKey, type Decision } from './decide.ts';
export {
  acceptProposal,
  applyAutomatically,
  dismissProposal,
  editAndAccept,
  expireProposals,
  idempotencyKey,
  PROPOSAL_EXPIRY_DAYS,
  submitProposals,
  type Resolved,
  type SubmitItem,
  type SubmitResult,
} from './engine.ts';
export {
  KindNotEnabled,
  SensitiveAiRefusedError,
  UndoExpiredError,
  UndoRefusedError,
} from './errors.ts';
export {
  ACTIVITY_EXPORT_FIELDS,
  exportActivities,
  listProposalsForDigest,
  type ActivityExportRow,
  type DigestProposal,
} from './export.ts';
export {
  buildHandlerRegistry,
  FORBIDDEN_KIND_PATTERN,
  HANDLERS,
  HandlerRegistrationError,
} from './handlers/index.ts';
export {
  AUTOMATION_LEVELS,
  fromNumericLevel,
  isAutomationLevel,
  toNumericLevel,
  UNDO_WINDOW_DAYS,
  type AutomationLevel as LadderLevel,
} from './levels.ts';
export { APPROVAL_MATRIX, type DecideContext, type MatrixRule } from './matrix.ts';
export { getAskFirst, setAskFirst } from './preferences.ts';
export { THRESHOLD_CAP, THRESHOLD_STEP } from './thresholds.ts';
export type { ActivityRow, ProposalHandler, ProposalRow } from './types.ts';
export {
  confirmActivity,
  previewUndo,
  reassignCapture,
  undoActivity,
  undoCapture,
  type ReassignResult,
  type UndoCaptureResult,
  type UndoPreview,
  type UndoResult,
} from './undo.ts';
export {
  getInbox,
  type CaptureProgress,
  type Inbox,
  type InboxAnchor,
  type InboxCounts,
  type InboxItem,
  type InboxItemType,
} from './read-models.ts';
