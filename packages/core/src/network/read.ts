// Read contributed copies (#485). The result has no contributor field: a copy never says which
// workspace stood behind it. The cause-list cache (#482) and corpus (#484) call this when no
// cleared fetch exists.
import { schema, type Queryable } from '@causedeck/db';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';

const { contributedDocument } = schema;

export interface ContributedCopy {
  id: string;
  sourceId: string;
  kind: schema.ContributableKind;
  forumLabel: string | null;
  listingDate: string | null;
  content: string;
  provenance: string;
  contributedAt: Date;
}

export interface FindContributedQuery {
  sourceId: string;
  kind: schema.ContributableKind;
  listingDate?: string;
  forumLabel?: string;
  now?: Date;
}

/** Live (not withdrawn, not past retention) copies for a source and kind, newest first. */
export async function findContributed(
  db: Queryable,
  query: FindContributedQuery,
): Promise<ContributedCopy[]> {
  const rows = await db
    .select({
      id: contributedDocument.id,
      sourceId: contributedDocument.sourceId,
      kind: contributedDocument.kind,
      forumLabel: contributedDocument.forumLabel,
      listingDate: contributedDocument.listingDate,
      content: contributedDocument.content,
      provenance: contributedDocument.provenance,
      contributedAt: contributedDocument.contributedAt,
    })
    .from(contributedDocument)
    .where(
      and(
        eq(contributedDocument.sourceId, query.sourceId),
        eq(contributedDocument.kind, query.kind),
        isNull(contributedDocument.withdrawnAt),
        gt(contributedDocument.retentionUntil, query.now ?? new Date()),
        query.listingDate === undefined
          ? undefined
          : eq(contributedDocument.listingDate, query.listingDate),
        query.forumLabel === undefined
          ? undefined
          : eq(contributedDocument.forumLabel, query.forumLabel),
      ),
    )
    .orderBy(desc(contributedDocument.contributedAt));
  return rows.flatMap((r) => (r.content === null ? [] : [{ ...r, content: r.content }]));
}
