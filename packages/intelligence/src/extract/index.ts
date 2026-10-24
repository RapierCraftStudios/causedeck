// Anchored order extraction (#46). Pure steps (dates, anchors, relative dates, pre-parse,
// validation, drafting) plus `extractOrder`, which adds the one gateway call. Nothing here
// imports `@causedeck/core`.
export {
  DATE_FORMATS,
  datePresence,
  findDateLiterals,
  mapIndicDigits,
  renderDate,
  type DateFormat,
  type DateLiteral,
} from './dates.ts';
export {
  FUZZY_CONFIDENCE_PENALTY,
  FUZZY_TOLERANCE,
  normaliseQuote,
  verifyAnchor,
  type AnchorResult,
  type PageText,
} from './anchors.ts';
export {
  addInterval,
  findRelativePhrases,
  RELATIVE_RULE,
  resolveRelative,
  type Derivation,
  type RelativeUnit,
} from './relative.ts';
export { looksLikeInjection, preParse, type PreParse } from './preparse.ts';
export {
  DIRECTION_KINDS,
  ExtractionAnchorSchema,
  NEEDS_YOU_REASONS,
  OrderExtractionSchema,
  REJECTION_REASONS,
  type ExtractionNeedsYouReason,
  type ExtractionAnchor,
  type OrderExtraction,
  type Rejected,
} from './schema.ts';
export {
  DETERMINISTIC_MAX_CONFIDENCE,
  LOW_CONFIDENCE,
  validateExtraction,
  type ModelOrderOutput,
  type ValidateInput,
} from './validate.ts';
export { buildExtractInput, EXTRACT_ORDER_PROMPT_ID } from './prompt.ts';
export {
  EXTRACTION_PIPELINE_VERSION,
  extractOrder,
  MODEL_BUDGET_MS,
  type ExtractOrderDeps,
  type ExtractOrderResult,
} from './order.ts';
export {
  anchorKey,
  collectAnchors,
  toProposalDrafts,
  type ProposalContext,
} from './to-proposals.ts';
