// A user's "this value is wrong" report on a fetched fact (#518). It needs the user's consent to
// share the record with CauseDeck staff, and the user must watch the record (a case watch on the
// proceeding): a report about a case the workspace does not watch is NOT_FOUND.
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { invalid, notFound } from '../shared/errors.ts';

import { dueAtFor } from './queue.ts';

const { caseWatch, reviewItem } = schema;

export interface ReportErrorInput {
  proceedingId: string;
  field: schema.ReviewField;
  /** The value the product showed. */
  shownValue: string;
  /** The value the user says is right. */
  reportedValue: string;
  /** The user agrees to share the record with CauseDeck staff for correction. */
  consent: boolean;
}

export interface ReportActor {
  userId: string;
  workspaceId: string;
}

const MAX_VALUE = 200;

/** File a user report in the review queue. Returns the item id. */
export async function reportRecordError(
  db: Queryable,
  actor: ReportActor,
  input: ReportErrorInput,
  now: Date = new Date(),
): Promise<{ id: string }> {
  if (!input.consent) throw invalid('Consent to share the record with CauseDeck staff is required');
  const shown = input.shownValue.trim();
  const reported = input.reportedValue.trim();
  if (reported === '' || reported.length > MAX_VALUE || shown.length > MAX_VALUE) {
    throw invalid('Enter the correct value (up to 200 characters)');
  }
  const [watch] = await withWorkspace(db, { workspaceId: actor.workspaceId }, (tx) =>
    tx
      .select({ sourceId: caseWatch.sourceId, cnr: caseWatch.cnr })
      .from(caseWatch)
      .where(
        and(
          eq(caseWatch.workspaceId, actor.workspaceId),
          eq(caseWatch.proceedingId, input.proceedingId),
        ),
      )
      .limit(1),
  );
  if (watch?.cnr == null) throw notFound('Matter not found');
  const [row] = await db
    .insert(reviewItem)
    .values({
      kind: 'user_report',
      sourceId: watch.sourceId,
      cnr: watch.cnr,
      field: input.field,
      shownValue: shown,
      reportedValue: reported,
      consent: true,
      dueAt: dueAtFor('user_report', now),
    })
    .returning({ id: reviewItem.id });
  if (row === undefined) throw new Error('review item was not created');
  return { id: row.id };
}
