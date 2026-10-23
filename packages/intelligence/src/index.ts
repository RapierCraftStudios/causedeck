// Document intelligence (#45): the capture -> document pipeline (text layer, OCR fallback,
// language, classification, page rendering, persistence). Core wires its ports; nothing here
// imports `@causedeck/core`.
export const packageName: string = '@causedeck/intelligence';

export * from './classify/index.ts';
export * from './events.ts';
export {
  detectDocumentLanguage,
  detectLanguage,
  LANGUAGE_TAGS,
  type LanguageTag,
} from './language/detect.ts';
export {
  createGatewayOcr,
  DEFAULT_OCR_BATCH,
  runOcr,
  type OcrLanguage,
  type OcrPageInput,
  type OcrPageResult,
  type OcrPort,
} from './ocr/ocr.ts';
export {
  createDbPersister,
  type DbPersisterOptions,
  type ExistingDocument,
  type PersistHook,
  type PersistInput,
  type PersistPage,
  type PersistResult,
  type Persister,
} from './persist.ts';
export {
  processCapture,
  type DeferredOutcome,
  type FinishedOutcome,
  type PersistedHook,
  type PipelineDeps,
  type PipelineInput,
  type PipelineOutcome,
} from './pipeline/run.ts';
export { hammingDistance, simhash, sniffFormat, type InputFormat } from './pipeline/steps.ts';
export {
  DEFAULT_PIPELINE_OPTIONS,
  PIPELINE_VERSION,
  type PipelineOptions,
} from './pipeline/version.ts';
export { mupdfRenderer } from './render/mupdf.ts';
export { noRenderer, type PageRenderer } from './render/renderer.ts';
export { DEFAULT_MIN_PAGE_CHARS, isGarbled, normaliseText } from './text/quality.ts';
export * from './extract/index.ts';
export {
  structureHearing,
  validateHearing,
  flagInstructionLike,
  type RawHearing,
  type StructureHearingInput,
  type StructureHearingOptions,
} from './structure/hearing.ts';
export {
  MATCH_MIN_SCORE,
  rankMatters,
  spokenCaseNumbers,
  type ListingContext,
  type MatchResult,
  type MatterCandidate,
  type RankedMatter,
} from './structure/match-matter.ts';
export {
  HearingStructuredSchema,
  ValidatedHearingSchema,
  type FlaggedSpan,
  type HearingStructured,
  type NeedsYouReason,
  type Rejected,
  type RejectReason,
  type Span,
  type StructuredResult,
  type ValidatedHearing,
} from './structure/schema.ts';
export { findSpokenDates, parseSpokenDate, type SpokenDate } from './structure/spoken-dates.ts';
export { hearingToProposalDrafts, type HearingDraftContext } from './structure/to-proposals.ts';
export {
  createSidecarTranscribe,
  readTranscriptSidecar,
  sidecarTranscript,
  type SidecarTranscribe,
  type TranscriptSidecar,
} from './transcribe/mock.ts';
export {
  buildTranscript,
  createGatewayTranscribe,
  languageHints,
  type GatewayTranscribeOptions,
  type TranscribeInput,
  type TranscribePort,
  type Transcript,
  type TranscriptLanguage,
  type TranscriptSegment,
} from './transcribe/transcribe.ts';
