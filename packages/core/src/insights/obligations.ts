// Obligation health (#85): the missed-obligation rate (overdue without a deliberate reschedule,
// divided by due), the capture completeness of the obligations arising from orders, and the count
// of deliberate reschedules, which are never a miss.
import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import {
  InsightsQuery,
  type InsightsWindow,
  type ObligationHealth,
} from '@causedeck/validators/insights';
import { and, eq, gte, isNotNull, lt, lte, notInArray } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';
import { povIstDay } from '../pov/index.ts';

import { insightsViewer, type InsightsActor, type InsightsDeps } from './access.ts';
import { classifyObligation, rate } from './classify.ts';
import { rescheduleCounts } from './prepared-kept.ts';
import { addDays, istEnd, istStart, resolveWindow } from './range.ts';

const { obligation, obligationEvent, order } = schema;

/** The computation on an open transaction; the viewer's scope is already decided. */
export async function obligationHealthIn(
  tx: Transaction,
  workspaceId: string,
  memberId: string | null,
  window: InsightsWindow,
  today: string,
): Promise<ObligationHealth> {
  const mine = memberId === null ? [] : [eq(obligation.ownerMemberId, memberId)];
  // Due in the range, up to today; a decision to close as not applicable is not a due item.
  const dueRows = await tx
    .select({
      id: obligation.id,
      status: obligation.status,
      ownerMemberId: obligation.ownerMemberId,
      dueDate: obligation.dueDate,
    })
    .from(obligation)
    .where(
      and(
        eq(obligation.workspaceId, workspaceId),
        isNotNull(obligation.dueDate),
        gte(obligation.dueDate, window.from),
        lte(obligation.dueDate, window.to),
        lt(obligation.dueDate, addDays(today, 1)),
        notInArray(obligation.status, ['not_applicable', 'superseded']),
        ...mine,
      ),
    );
  const counts = await rescheduleCounts(
    tx,
    workspaceId,
    dueRows.map((o) => o.id),
  );
  let kept = 0;
  let missed = 0;
  for (const o of dueRows) {
    const outcome = classifyObligation({ ...o, reschedules: counts.get(o.id) ?? 0 }, today);
    if (outcome === 'kept') kept += 1;
    if (outcome === 'missed') missed += 1;
  }

  // Capture completeness: obligations drawn from an order dated in the range.
  const drawn = await tx
    .select({ owner: obligation.ownerMemberId, dueDate: obligation.dueDate })
    .from(obligation)
    .innerJoin(
      order,
      and(eq(order.workspaceId, obligation.workspaceId), eq(order.id, obligation.sourceOrderId)),
    )
    .where(
      and(
        eq(obligation.workspaceId, workspaceId),
        gte(order.orderDate, window.from),
        lte(order.orderDate, window.to),
        ...mine,
      ),
    );
  const captured = drawn.filter((o) => o.owner !== null && o.dueDate !== null).length;

  // Deliberate reschedules recorded in the range.
  const reschedules = await tx
    .select({ id: obligationEvent.id })
    .from(obligationEvent)
    .innerJoin(
      obligation,
      and(
        eq(obligation.workspaceId, obligationEvent.workspaceId),
        eq(obligation.id, obligationEvent.obligationId),
      ),
    )
    .where(
      and(
        eq(obligationEvent.workspaceId, workspaceId),
        eq(obligationEvent.kind, 'rescheduled'),
        gte(obligationEvent.at, istStart(window.from)),
        lt(obligationEvent.at, istEnd(window.to)),
        ...mine,
      ),
    );
  return {
    window,
    due: dueRows.length,
    kept,
    missed,
    missedRate: rate(missed, dueRows.length),
    keptRate: rate(kept, dueRows.length),
    capturedTotal: drawn.length,
    captured,
    captureCompleteness: rate(captured, drawn.length),
    deliberateReschedules: reschedules.length,
  };
}

/** Obligation health for the range, within the actor's workspace (a junior: their own). */
export async function obligationHealth(
  deps: InsightsDeps,
  actor: InsightsActor,
  input: unknown,
): Promise<ObligationHealth> {
  const parsed = InsightsQuery.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid range');
  const viewer = await insightsViewer(deps, actor, parsed.data.memberId);
  const today = povIstDay((deps.now ?? (() => new Date()))());
  const window = resolveWindow(parsed.data, today);
  return withWorkspace(deps.db, actor, (tx) =>
    obligationHealthIn(tx, actor.workspaceId, viewer.memberId, window, today),
  );
}
