// The verdict on one citation. `verified` is awarded only on an exact structured match (the
// resolver returned that very citation, once) plus a title similarity at or above the threshold
// against the case name written next to it. Everything ambiguous is `unknown`; a citation the
// resolver definitively does not know is `not_found`. An outage or throttle is `unknown`, never
// `verified`. Only the citation, status, canonical URL and a short title leave this function.
import {
  CITATION_TITLE_MAX,
  type CitationKind,
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
  /** The title is withheld (a masked judgment), so an exact structured match alone verifies. */
  titleMasked?: boolean;
  /** The resolver's pinpoint or quote check; `verified` or the reason it failed. */
  check?: { quote: 'verified' | CitationReason };
}

export type ResolverOutcome =
  { kind: 'hits'; hits: readonly ResolverHit[] } | { kind: 'unavailable' } | { kind: 'throttled' };

export interface Verdict {
  status: CitationStatus;
  reason?: CitationReason;
  sourceUrl?: string;
  title?: string;
  similarity?: number;
  /** Set when a quote was checked: `verified`, or `not_found` for a quote not in its passage. */
  quoteChecked?: 'verified' | 'not_found';
}

/** Default minimum title similarity for `verified`. */
export const TITLE_THRESHOLD = 0.7;

export interface ClassifyInput {
  normalized: string;
  titleHint?: string;
  kind?: CitationKind;
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
  if (exact.length === 0) {
    return citation.kind === 'section'
      ? { status: 'not_found', reason: 'section_not_found' }
      : { status: 'not_found' };
  }
  const urls = new Set(exact.map((hit) => hit.sourceUrl));
  const hit = exact[0];
  if (urls.size > 1 || hit === undefined) return { status: 'unknown', reason: 'ambiguous' };
  const base = { sourceUrl: hit.sourceUrl, title: shortTitle(hit.title) };
  const quote = hit.check?.quote;
  if (quote !== undefined && quote !== 'verified') {
    return {
      status: 'unknown',
      reason: quote,
      ...(quote === 'quote_not_found' ? { quoteChecked: 'not_found' as const } : {}),
      ...base,
    };
  }
  const checked = quote === 'verified' ? { quoteChecked: 'verified' as const } : {};
  if (hit.titleMasked === true) return { status: 'verified', ...checked, ...base };
  if (citation.titleHint === undefined) {
    return { status: 'unknown', reason: 'title_missing', ...checked, ...base };
  }
  const similarity = titleSimilarity(citation.titleHint, hit.title);
  if (similarity < titleThreshold) {
    return { status: 'unknown', reason: 'title_mismatch', similarity, ...checked, ...base };
  }
  return { status: 'verified', similarity, ...checked, ...base };
}
