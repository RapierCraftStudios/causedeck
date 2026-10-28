// The lawyer's manual "court is at item N" marker per hall and date (#58). An internal note: it never
// changes a listing (live display-board tracking is `board_observation`, #493). Each change writes an
// `audit_event` (ids and numbers only; the free-text note stays out of the audit metadata).
import { schema } from '@causedeck/db';
import { ClearCurrentItemInput, CurrentItemMarker } from '@causedeck/validators';
import { and, eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { notFound } from '../shared/errors.ts';

import {
  inCourtDayScope,
  parseCourtDayInput,
  requireAction,
  type CourtDayActor,
  type CourtDayDeps,
  type CourtDayScope,
} from './scope.ts';

const { courtDayMarker, courtHall } = schema;

export interface MarkerRow {
  id: string;
  hallId: string;
  listDate: string;
  currentItem: number;
  setBy: string | null;
  setAt: Date;
  note: string | null;
}

async function requireHall(scope: CourtDayScope, hallId: string): Promise<void> {
  const [hall] = await scope.tx
    .select({ id: courtHall.id })
    .from(courtHall)
    .where(eq(courtHall.id, hallId))
    .limit(1);
  if (hall === undefined) throw notFound('Hall not found');
}

/** Set (or move) the marker of a hall and date; the setter and time are stored. Needs `matter.write`. */
export async function setCurrentItem(
  deps: CourtDayDeps,
  actor: CourtDayActor,
  input: CurrentItemMarker,
): Promise<MarkerRow> {
  const data = parseCourtDayInput(CurrentItemMarker, input);
  return inCourtDayScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId, userId } = scope.actor;
    requireAction(scope, 'matter.write', await scope.settings(), 'You cannot set the current item');
    await requireHall(scope, data.hallId);
    const note = data.note ?? null;
    const [row] = await tx
      .insert(courtDayMarker)
      .values({
        workspaceId,
        hallId: data.hallId,
        listDate: data.listDate,
        currentItem: data.currentItem,
        setBy: userId,
        note,
      })
      .onConflictDoUpdate({
        target: [courtDayMarker.workspaceId, courtDayMarker.hallId, courtDayMarker.listDate],
        set: { currentItem: data.currentItem, setBy: userId, setAt: new Date(), note },
      })
      .returning();
    if (row === undefined) throw new Error('setCurrentItem: upsert returned no row');
    await record(
      { db: tx, workspaceId, actor: { userId, kind: 'user' } },
      {
        action: 'court_day.marker_set',
        target: { kind: 'court_day_marker', id: row.id },
        metadata: { hallId: data.hallId, listDate: data.listDate, currentItem: data.currentItem },
      },
    );
    return row;
  });
}

/** Remove the marker of a hall and date; true when one existed. Needs `matter.write`. */
export async function clearCurrentItem(
  deps: CourtDayDeps,
  actor: CourtDayActor,
  input: ClearCurrentItemInput,
): Promise<boolean> {
  const data = parseCourtDayInput(ClearCurrentItemInput, input);
  return inCourtDayScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId, userId } = scope.actor;
    requireAction(
      scope,
      'matter.write',
      await scope.settings(),
      'You cannot clear the current item',
    );
    const removed = await tx
      .delete(courtDayMarker)
      .where(
        and(
          eq(courtDayMarker.workspaceId, workspaceId),
          eq(courtDayMarker.hallId, data.hallId),
          eq(courtDayMarker.listDate, data.listDate),
        ),
      )
      .returning({ id: courtDayMarker.id });
    const [gone] = removed;
    if (gone === undefined) return false;
    await record(
      { db: tx, workspaceId, actor: { userId, kind: 'user' } },
      {
        action: 'court_day.marker_cleared',
        target: { kind: 'court_day_marker', id: gone.id },
        metadata: { hallId: data.hallId, listDate: data.listDate },
      },
    );
    return true;
  });
}
