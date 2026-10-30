// Prepared & Kept (#85), the north star: of the appearances listed in the range, the share where a
// current brief was confirmed before the hearing AND every obligation arising from the hearing is
// captured, owned and kept or deliberately rescheduled. "Arising from the hearing" means the
// obligations drawn from an order of the same proceeding dated on the hearing day.
import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import {
  InsightsQuery,
  type InsightsWindow,
  type PreparedKept,
} from '@causedeck/validators/insights';
import { and, count, eq, gte, inArray, lt, lte } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';
import { isoWeekIst, povIstDay } from '../pov/index.ts';

import { insightsViewer, type InsightsActor, type InsightsDeps } from './access.ts';
import {
  classifyAppearance,
  classifyObligation,
  rate,
  type AppearanceOutcome,
  type ObligationOutcome,
} from './classify.ts';
import { addDays, istStart, previousWindow, resolveWindow } from './range.ts';

const { appearance, briefState, hearing, listing, obligation, obligationEvent, order } = schema;

/** Courts sit from about 10:00 IST: a brief confirmed before then on the day counts as before. */
export const HEARING_START_HOUR_IST = 10;

interface Decided {
  week: string;
  outcome: AppearanceOutcome;
}

/** Reschedule counts by obligation id. */
export async function rescheduleCounts(
  tx: Transaction,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const rows = await tx
    .select({ id: obligationEvent.obligationId, n: count() })
    .from(obligationEvent)
    .where(
      and(
        eq(obligationEvent.workspaceId, workspaceId),
        eq(obligationEvent.kind, 'rescheduled'),
        inArray(obligationEvent.obligationId, [...ids]),
      ),
    )
    .groupBy(obligationEvent.obligationId);
  for (const row of rows) counts.set(row.id, row.n);
  return counts;
}

/** Every held appearance in the window, decided on the day `today`. */
async function decideAppearances(
  tx: Transaction,
  workspaceId: string,
  memberId: string | null,
  window: InsightsWindow,
  today: string,
): Promise<Decided[]> {
  const held = await tx
    .select({
      heldOn: hearing.heldOn,
      proceedingId: listing.proceedingId,
      preparedAt: briefState.preparedAt,
    })
    .from(appearance)
    .innerJoin(
      hearing,
      and(eq(hearing.workspaceId, appearance.workspaceId), eq(hearing.id, appearance.hearingId)),
    )
    .innerJoin(
      listing,
      and(eq(listing.workspaceId, hearing.workspaceId), eq(listing.id, hearing.listingId)),
    )
    .leftJoin(
      briefState,
      and(eq(briefState.workspaceId, listing.workspaceId), eq(briefState.listingId, listing.id)),
    )
    .where(
      and(
        eq(appearance.workspaceId, workspaceId),
        gte(hearing.heldOn, window.from),
        lte(hearing.heldOn, window.to),
        // A hearing is decided only after its day.
        lt(hearing.heldOn, today),
        ...(memberId === null ? [] : [eq(appearance.memberId, memberId)]),
      ),
    );
  if (held.length === 0) return [];

  const proceedingIds = [...new Set(held.map((h) => h.proceedingId))];
  const dates = [...new Set(held.map((h) => h.heldOn))];
  const arising = await tx
    .select({
      id: obligation.id,
      proceedingId: order.proceedingId,
      orderDate: order.orderDate,
      status: obligation.status,
      ownerMemberId: obligation.ownerMemberId,
      dueDate: obligation.dueDate,
    })
    .from(obligation)
    .innerJoin(
      order,
      and(eq(order.workspaceId, obligation.workspaceId), eq(order.id, obligation.sourceOrderId)),
    )
    .where(
      and(
        eq(obligation.workspaceId, workspaceId),
        inArray(order.proceedingId, proceedingIds),
        inArray(order.orderDate, dates),
      ),
    );
  const reschedules = await rescheduleCounts(
    tx,
    workspaceId,
    arising.map((o) => o.id),
  );
  const outcomes = new Map<string, ObligationOutcome[]>();
  for (const o of arising) {
    const key = `${o.proceedingId}|${o.orderDate}`;
    const list = outcomes.get(key) ?? [];
    list.push(
      classifyObligation(
        {
          status: o.status,
          ownerMemberId: o.ownerMemberId,
          dueDate: o.dueDate,
          reschedules: reschedules.get(o.id) ?? 0,
        },
        today,
      ),
    );
    outcomes.set(key, list);
  }
  return held.map((h) => {
    const cutoff = new Date(istStart(h.heldOn).getTime() + HEARING_START_HOUR_IST * 3600 * 1000);
    const briefed = h.preparedAt !== null && h.preparedAt.getTime() < cutoff.getTime();
    return {
      week: isoWeekIst(istStart(h.heldOn)),
      outcome: classifyAppearance(briefed, outcomes.get(`${h.proceedingId}|${h.heldOn}`) ?? []),
    };
  });
}

function tally(decided: readonly Decided[]) {
  const numerator = decided.filter((d) => d.outcome === 'kept').length;
  const denominator = decided.filter((d) => d.outcome !== 'pending').length;
  return { numerator, denominator, rate: rate(numerator, denominator) };
}

/** The ISO weeks the window touches, in order. */
function weeksOf(window: InsightsWindow): string[] {
  const weeks: string[] = [];
  for (let day = window.from; day <= window.to; day = addDays(day, 1)) {
    const week = isoWeekIst(istStart(day));
    if (weeks[weeks.length - 1] !== week) weeks.push(week);
  }
  return weeks;
}

/** The computation on an open transaction; the viewer's scope is already decided. */
export async function preparedKeptIn(
  tx: Transaction,
  workspaceId: string,
  memberId: string | null,
  window: InsightsWindow,
  today: string,
): Promise<PreparedKept> {
  const decided = await decideAppearances(tx, workspaceId, memberId, window, today);
  const before = previousWindow(window);
  const prior = await decideAppearances(tx, workspaceId, memberId, before, today);
  return {
    window,
    ...tally(decided),
    pending: decided.filter((d) => d.outcome === 'pending').length,
    weeks: weeksOf(window).map((week) => ({
      week,
      ...tally(decided.filter((d) => d.week === week)),
    })),
    previous: { window: before, ...tally(prior) },
  };
}

/**
 * Prepared & Kept for the range (numerator, denominator and rate), computed within the actor's
 * workspace from hearings, brief state and obligations. A junior's figure counts only their own
 * appearances; a clerk or viewer is FORBIDDEN.
 */
export async function computePreparedKept(
  deps: InsightsDeps,
  actor: InsightsActor,
  input: unknown,
): Promise<PreparedKept> {
  const parsed = InsightsQuery.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid range');
  const viewer = await insightsViewer(deps, actor, parsed.data.memberId);
  const now = (deps.now ?? (() => new Date()))();
  const today = povIstDay(now);
  const window = resolveWindow(parsed.data, today);
  return withWorkspace(deps.db, actor, (tx) =>
    preparedKeptIn(tx, actor.workspaceId, viewer.memberId, window, today),
  );
}
