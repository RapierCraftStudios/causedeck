import type { CitationKind } from '@causedeck/validators/citation';

import type { ResolverOutcome } from '../match';

export interface ResolveRequest {
  normalized: string;
  kind: CitationKind;
}

export interface CitationResolver {
  name: string;
  /** True when a call leaves the process, so it counts against the rate limit and daily budget. */
  external: boolean;
  resolve(request: ResolveRequest): Promise<ResolverOutcome>;
}
