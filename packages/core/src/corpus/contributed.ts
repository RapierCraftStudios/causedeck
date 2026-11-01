// Corpus read path over contributed copies (#594, from #485). The raw judgments corpus (#484)
// holds judgments only; a published order can only reach the shared store as a contributed copy.
// Call this when no cleared fetch (and so no corpus row) exists for the source. The result has no
// contributor field: a copy never says which workspace stood behind it.
import type { Queryable } from '@causedeck/db';

import { findContributed, type ContributedCopy } from '../network/index.ts';

export interface FindContributedOrdersQuery {
  sourceId: string;
  /** The court or forum named on the public order. */
  forumLabel?: string;
  /** Retention is judged at this time; defaults to now. */
  now?: Date;
}

/** Live (not withdrawn, not past retention) contributed order copies for a source, newest first. */
export function findContributedOrders(
  db: Queryable,
  query: FindContributedOrdersQuery,
): Promise<ContributedCopy[]> {
  return findContributed(db, { ...query, kind: 'order' });
}
