// The verdict on one citation. `verified` is awarded only on an exact structured match (the
// resolver returned that very citation, once) plus a title similarity at or above the threshold
// against the case name written next to it. Everything ambiguous is `unknown`; a citation the
// resolver definitively does not know is `not_found`. An outage or throttle is `unknown`, never
// `verified`. Only the citation, status, canonical URL and a short title leave this function.
import {
  CITATION_TITLE_MAX,
  type CitationReason,
  type CitationStatus,
} from '@causedeck/validators/citation';

import { titleSimilarity } from './normalize';

/** One authority a resolver says the citation points to. No judgment text, ever. */
export interface ResolverHit {
  /** The citation the authority carries, in canonical form. */
  citation: string;
  title: string;
  sourceUrl: string;
}

export type ResolverOutcome =
  { kind: 'hits'; hits: readonly ResolverHit[] } | { kind: 'unavailable' } | { kind: 'throttled' };

export interface Verdict {
  status: CitationStatus;
  reason?: CitationReason;
  sourceUrl?: string;
  title?: string;
  similarity?: number;
}

/** Default minimum title similarity for `verified`. */
export const TITLE_THRESHOLD = 0.7;

export interface ClassifyInput {
  normalized: string;
  titleHint?: string;
}

export function shortTitle(title: string): string {
  return title
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CITATION_TITLE_MAX);
}

export function classify(
  citation: ClassifyInput,
  outcome: ResolverOutcome,
  { titleThreshold = TITLE_THRESHOLD }: { titleThreshold?: number } = {},
): Verdict {
  if (outcome.kind === 'unavailable') return { status: 'unknown', reason: 'resolver_unavailable' };
  if (outcome.kind === 'throttled') return { status: 'unknown', reason: 'throttled' };
  const exact = outcome.hits.filter((hit) => hit.citation === citation.normalized);
  if (exact.length === 0) return { status: 'not_found' };
  const urls = new Set(exact.map((hit) => hit.sourceUrl));
  const hit = exact[0];
  if (urls.size > 1 || hit === undefined) return { status: 'unknown', reason: 'ambiguous' };
  const base = { sourceUrl: hit.sourceUrl, title: shortTitle(hit.title) };
  if (citation.titleHint === undefined) {
    return { status: 'unknown', reason: 'title_missing', ...base };
  }
  const similarity = titleSimilarity(citation.titleHint, hit.title);
  if (similarity < titleThreshold) {
    return { status: 'unknown', reason: 'title_mismatch', similarity, ...base };
  }
  return { status: 'verified', similarity, ...base };
}
