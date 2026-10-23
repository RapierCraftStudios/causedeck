// The raw judgments corpus (#484, D-048): header extraction and ingestion through the governed
// fetch layer. No editorial content is produced here.
export {
  canonicalNeutralCitation,
  courtOfCitation,
  extractJudgmentHeader,
  HEADER_PAGES,
  type JudgmentHeader,
} from './header.ts';
export {
  bodyBytes,
  ingestJudgment,
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
