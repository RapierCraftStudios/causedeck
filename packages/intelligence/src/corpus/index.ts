// The raw judgments corpus (#484, D-048): header extraction and ingestion through the governed
// fetch layer. No editorial content is produced here.
export {
  canonicalNeutralCitation,
  courtOfCitation,
  extractJudgmentHeader,
  HEADER_PAGES,
  type JudgmentHeader,
} from './header.ts';
export * from './bulk/index.ts';
export * from './enrich/index.ts';
export * from './redact/index.ts';
export {
  classifyParagraphs,
  estimateTokens,
  fullText,
  MAX_SEGMENT_TOKENS,
  MIN_SEGMENT_TOKENS,
  packSegments,
  resolveLowConfidence,
  roleReplySchema,
  ROLE_CONFIDENCE_THRESHOLD,
  SEGMENT_ROLES,
  SEGMENT_VERSION,
  segmentJudgment,
  segmentJudgmentWithResolver,
  splitParagraphs,
  type Paragraph as SegmentParagraph,
  type RoleGuess,
  type RoleQuestion,
  type RoleResolver,
  type Segment,
  type SegmentPage,
  type SegmentRole,
} from './segment.ts';
export {
  bodyBytes,
  corpusBlobKey,
  ingestJudgment,
  storeJudgment,
  type CorpusBlobStore,
  type JudgmentMetadata,
  type StoreDeps,
  type StoredOutcome,
  type CorpusFetcher,
  type CorpusFetchResult,
  type IngestDeps,
  type IngestOutcome,
} from './ingest.ts';
export {
  matchJudgmentToTags,
  type MatchablePage,
  type MatchableTag,
  type TagMatch,
} from './match.ts';
