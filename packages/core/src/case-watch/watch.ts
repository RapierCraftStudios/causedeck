// Case-status watches (#591, part 3 of #483, D-048): an advocate watches one of their own
// proceedings at a status source, by CNR or case number. A watch is always the advocate's own
// (`advocate_user_id` is the actor), on a proceeding whose matter the actor can read, so a lookup
// that runs for it is a delegated one on the advocate's own matter and nothing else.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq } from 'drizzle-orm';

import { getCanonicalNextDate, type GraphActor, type MatterGraphDeps } from '../matter-graph/index.ts';
import { invalid, notFound } from '../shared/errors.ts';

const { caseWatch } = schema;

type Db = Database | Transaction;

const MAX_WATCHES_PER_MEMBER = 50;
const MIN_CADENCE_MINUTES = 60;
const CNR = new RegExp(schema.CNR_PATTERN);

const NO_EVENTS: MatterGraphDeps['events'] = {
  emit() {
    // The readability probe emits nothing.
  },
};

export type CaseWatchRow = typeof caseWatch.$inferSelect;

export interface AddCaseWatchInput {
  proceedingId: string;
  sourceId: string;
  /** The CNR to look up; give this or `caseNumber`. */
  cnr?: string | null;
  caseNumber?: string | null;
  cadenceMinutes?: number;
}

/** Watch a proceeding of the actor's own. The same proceeding and source again returns that watch. */
export async function addCaseWatch(
  deps: { db: Db },
  actor: GraphActor,
  input: AddCaseWatchInput,
): Promise<CaseWatchRow> {
  const cnr = input.cnr?.trim().toUpperCase() || null;
  const caseNumber = input.caseNumber?.trim().replace(/\s+/g, ' ') || null;
  if (cnr === null && caseNumber === null) throw invalid('Enter a CNR or a case number');
  if (cnr !== null && !CNR.test(cnr)) throw invalid('Enter a valid CNR');
  if (caseNumber !== null && caseNumber.length > 100) throw invalid('Case number is too long');
  const cadenceMinutes = input.cadenceMinutes ?? 1440;
  if (!Number.isInteger(cadenceMinutes) || cadenceMinutes < MIN_CADENCE_MINUTES) {
    throw invalid('A watch cannot poll more often than hourly');
  }
  // The actor must be able to read the proceeding's matter (NOT_FOUND otherwise).
  await getCanonicalNextDate({ db: deps.db, events: NO_EVENTS }, actor, {
    proceedingId: input.proceedingId,
  });
  return withWorkspace(deps.db, actor, async (tx) => {
    const mine = and(
      eq(caseWatch.workspaceId, actor.workspaceId),
      eq(caseWatch.advocateUserId, actor.userId),
    );
    const held = await tx.select({ id: caseWatch.id }).from(caseWatch).where(mine);
    if (held.length >= MAX_WATCHES_PER_MEMBER) throw invalid('Too many watches');
    await tx
      .insert(caseWatch)
      .values({
        workspaceId: actor.workspaceId,
        proceedingId: input.proceedingId,
        sourceId: input.sourceId,
        cnr,
        caseNumber,
        advocateUserId: actor.userId,
        cadenceMinutes,
      })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(caseWatch)
      .where(
        and(
          eq(caseWatch.workspaceId, actor.workspaceId),
          eq(caseWatch.proceedingId, input.proceedingId),
          eq(caseWatch.sourceId, input.sourceId),
        ),
      );
    // A watch of another advocate on the same proceeding and source is not the actor's.
    if (row === undefined || row.advocateUserId !== actor.userId) {
      throw invalid('That proceeding is already watched at this source');
    }
    return row;
  });
}

/** The actor's own watches, oldest first. */
export async function listCaseWatches(deps: { db: Db }, actor: GraphActor): Promise<CaseWatchRow[]> {
  return withWorkspace(deps.db, actor, (tx) =>
    tx
      .select()
      .from(caseWatch)
      .where(
        and(
          eq(caseWatch.workspaceId, actor.workspaceId),
          eq(caseWatch.advocateUserId, actor.userId),
        ),
      )
      .orderBy(asc(caseWatch.createdAt), asc(caseWatch.id)),
  );
}

/** Remove one of the actor's own watches (its snapshots go with it); another's id is not found. */
export async function removeCaseWatch(
  deps: { db: Db },
  actor: GraphActor,
  watchId: string,
): Promise<void> {
  const removed = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .delete(caseWatch)
      .where(
        and(
          eq(caseWatch.workspaceId, actor.workspaceId),
          eq(caseWatch.advocateUserId, actor.userId),
          eq(caseWatch.id, watchId),
        ),
      )
      .returning({ id: caseWatch.id }),
  );
  if (removed.length === 0) throw notFound('Watch not found');
}
