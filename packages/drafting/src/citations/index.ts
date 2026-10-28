// Citation checker (#77, DR-2): detection, normalisation, resolution and verdicts. It only labels
// the citations an author wrote; nothing in this directory writes, repairs or proposes one.
export { checkCitations, type CheckedCitation, type CheckOptions } from './check';
export { extractCitations, extractFromText, type ExtractedCitation } from './extract';
export {
  classify,
  shortTitle,
  TITLE_THRESHOLD,
  type ClassifyInput,
  type ResolverHit,
  type ResolverOutcome,
  type Verdict,
} from './match';
export { normalizeCitation, normalizedCitationsIn, titleSimilarity } from './normalize';
export { CASE_NAME_PATTERN, STRUCTURED_PATTERNS, type CitationPattern } from './patterns';
export { createRateLimiter, type RateLimiter } from './rate-limit';
export { createIndianKanoonResolver, type IndianKanoonOptions } from './resolvers/indian-kanoon';
export { createMockResolver, MOCK_AUTHORITIES } from './resolvers/mock';
export { officialLink, type OfficialLink } from './resolvers/official-links';
export type { CitationResolver, ResolveRequest } from './resolvers/types';
