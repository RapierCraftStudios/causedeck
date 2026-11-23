import type { CitationKind, CitationPinpoint } from '@causedeck/validators/citation';

import type { ResolverOutcome } from '../match';

export interface ResolveRequest {
  normalized: string;
  kind: CitationKind;
  pinpoint?: CitationPinpoint;
  /** Only used to look the passage up; a resolver must not keep it. */
  quote?: string;
}

export interface CitationResolver {
  name: string;
  /** True when a call leaves the process, so it counts against the rate limit and daily budget. */
  external: boolean;
  resolve(request: ResolveRequest): Promise<ResolverOutcome>;
}
