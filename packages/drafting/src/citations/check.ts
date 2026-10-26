// Resolve and classify a list of extracted citations. Pure apart from the resolver it is given: the
// caller supplies the resolver, the limiter and how many external calls the workspace may still
// make today. A citation that would exceed either limit is `unknown` with reason `throttled`.
import type { CitationKind } from '@causedeck/validators/citation';

import type { ExtractedCitation } from './extract';
import { classify, type Verdict } from './match';
import type { RateLimiter } from './rate-limit';
import type { CitationResolver } from './resolvers/types';

export interface CheckedCitation extends ExtractedCitation {
  verdict: Verdict;
  /** True when the resolver was asked (a call that counts against the budget). */
  resolved: boolean;
}

export interface CheckOptions {
  resolver: CitationResolver;
  workspaceId: string;
  limiter?: RateLimiter;
  /** External calls still allowed today; unlimited when omitted. */
  budgetRemaining?: number;
  titleThreshold?: number;
}

const CHECKABLE: readonly CitationKind[] = ['neutral', 'reporter'];

export async function checkCitations(
  citations: readonly ExtractedCitation[],
  options: CheckOptions,
): Promise<CheckedCitation[]> {
  let budget = options.budgetRemaining ?? Number.POSITIVE_INFINITY;
  const out: CheckedCitation[] = [];
  for (const citation of citations) {
    if (!CHECKABLE.includes(citation.kind)) {
      out.push({ ...citation, verdict: { status: 'unknown', reason: 'unsupported' }, resolved: false });
      continue;
    }
    if (options.resolver.external) {
      if (budget < 1 || options.limiter?.tryAcquire(options.workspaceId) === false) {
        out.push({ ...citation, verdict: { status: 'unknown', reason: 'throttled' }, resolved: false });
        continue;
      }
      budget -= 1;
    }
    const outcome = await options.resolver.resolve({
      normalized: citation.normalized,
      kind: citation.kind,
    });
    out.push({
      ...citation,
      verdict: classify(citation, outcome, {
        ...(options.titleThreshold === undefined ? {} : { titleThreshold: options.titleThreshold }),
      }),
      resolved: options.resolver.external,
    });
  }
  return out;
}
