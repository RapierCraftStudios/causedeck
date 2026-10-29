// Deterministic offline resolver: the default in dev and CI. It answers from a fixed list of
// authorities and makes no network call.
import type { ResolverHit, ResolverOutcome } from '../match';

import type { CitationResolver, ResolveRequest } from './types';

export const MOCK_AUTHORITIES: readonly ResolverHit[] = [
  {
    citation: '2023 INSC 123',
    title: 'Ramesh Kumar v. State of Kerala',
    sourceUrl: 'https://mock.causedeck.test/doc/2023-INSC-123',
  },
  {
    citation: '2024:MHC:1234',
    title: 'Lakshmi Textiles v. Commissioner of Income Tax',
    sourceUrl: 'https://mock.causedeck.test/doc/2024-MHC-1234',
  },
  {
    citation: '2024:KHC:5678',
    title: 'Anitha Rao v. Bangalore Development Authority',
    sourceUrl: 'https://mock.causedeck.test/doc/2024-KHC-5678',
  },
];

export function createMockResolver(
  authorities: readonly ResolverHit[] = MOCK_AUTHORITIES,
  { unavailable = false }: { unavailable?: boolean } = {},
): CitationResolver {
  const byCitation = new Map<string, ResolverHit[]>();
  for (const hit of authorities) {
    byCitation.set(hit.citation, [...(byCitation.get(hit.citation) ?? []), hit]);
  }
  return {
    name: 'mock',
    external: false,
    resolve(request: ResolveRequest): Promise<ResolverOutcome> {
      if (unavailable) return Promise.resolve({ kind: 'unavailable' });
      return Promise.resolve({ kind: 'hits', hits: byCitation.get(request.normalized) ?? [] });
    },
  };
}
