// The matched-only rule (#57, docs/product/09 §8.4; #548): a list row is kept only when one of its
// advocates carries the lawyer's own identifier. A row that does not match is counted and dropped
// here: its content is never returned, stored or logged. With no identifiers nothing is kept.
import type { Advocate } from '@causedeck/adapters';

import { createAdvocateMatcher, hasIdentifiers, type AdvocateIdentifiers } from './identifiers.ts';

export interface MatchedRows<T> {
  matched: T[];
  /** A counter only: the rows themselves are not returned. */
  unmatchedCount: number;
}

export function filterMatchedRows<T extends { advocates?: readonly Advocate[] | undefined }>(
  rows: readonly T[],
  identifiers: AdvocateIdentifiers,
): MatchedRows<T> {
  if (!hasIdentifiers(identifiers)) return { matched: [], unmatchedCount: rows.length };
  const matches = createAdvocateMatcher(identifiers);
  const matched = rows.filter((row) => (row.advocates ?? []).some(matches));
  return { matched, unmatchedCount: rows.length - matched.length };
}
