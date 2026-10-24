// What a fix left in a workspace (#518): the corrections of a proceeding, newest first, each with
// the provenance "corrected by CauseDeck review" (`source_ref` `causedeck-review:<item>`).
import { schema, type Queryable } from '@causedeck/db';
import { and, desc, eq } from 'drizzle-orm';

const { reviewCorrection } = schema;

export interface ReviewCorrection {
  id: string;
  field: schema.ReviewField;
  value: string;
  reviewItemId: string;
  correctedAt: Date;
}

/** Corrections of one proceeding; the caller's workspace scope applies (RLS) and the id is checked. */
export async function listReviewCorrections(
  db: Queryable,
  workspaceId: string,
  proceedingId: string,
): Promise<ReviewCorrection[]> {
  const rows = await db
    .select()
    .from(reviewCorrection)
    .where(
      and(
        eq(reviewCorrection.workspaceId, workspaceId),
        eq(reviewCorrection.proceedingId, proceedingId),
      ),
    )
    .orderBy(desc(reviewCorrection.capturedAt));
  return rows.map((r) => ({
    id: r.id,
    field: r.field,
    value: r.value,
    reviewItemId: r.reviewItemId,
    correctedAt: r.capturedAt,
  }));
}
