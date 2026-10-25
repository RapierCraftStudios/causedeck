// `reconcileOrder` (#67): each operative direction of an order is an `obligation` (an obligation
// row with the order's `source_order_id` and the direction's `anchor_id`), `not_applicable` (one
// marked so, with its reason in words) or `unresolved`. An order is `reconciled` when none is
// unresolved; the unresolved count feeds brief readiness (#60). Directions have no id of their
// own (`order.operative_directions` is jsonb), so the anchor is the key.
import { schema, type Transaction } from '@causedeck/db';
import {
  DirectionNotApplicableInput,
  ReconcileInput,
} from '@causedeck/validators/obligation';
import { and, eq } from 'drizzle-orm';

import { conflict, invalid, notFound } from '../shared/errors.ts';

import {
  audit,
  addEvent,
  inObligationScope,
  parseInput,
  requireMatterFor,
  type ObligationActor,
  type ObligationDeps,
  type ObligationScope,
} from './context.ts';

const { obligation, order, proceeding } = schema;

export type DirectionState = 'obligation' | 'not_applicable' | 'unresolved';

export interface ReconciledDirection {
  text: string;
  anchorId: string;
  state: DirectionState;
  obligationId: string | null;
  /** The words a direction was marked not applicable with. */
  reason: string | null;
}

export interface OrderReconciliation {
  orderId: string;
  matterId: string;
  reconciled: boolean;
  unresolvedCount: number;
  directions: ReconciledDirection[];
}

async function reconcileIn(
  tx: Transaction,
  workspaceId: string,
  row: typeof order.$inferSelect,
  matterId: string,
): Promise<OrderReconciliation> {
  const linked = await tx
    .select({
      id: obligation.id,
      anchorId: obligation.anchorId,
      status: obligation.status,
      note: obligation.closedNote,
    })
    .from(obligation)
    .where(and(eq(obligation.workspaceId, workspaceId), eq(obligation.sourceOrderId, row.id)));
  const directions = row.operativeDirections.map((d): ReconciledDirection => {
    const matches = linked.filter((o) => o.anchorId === d.anchorId);
    const live = matches.find((o) => o.status !== 'not_applicable' && o.status !== 'superseded');
    const na = matches.find((o) => o.status === 'not_applicable');
    if (live !== undefined) {
      return { ...d, state: 'obligation', obligationId: live.id, reason: null };
    }
    if (na !== undefined) {
      return { ...d, state: 'not_applicable', obligationId: na.id, reason: na.note };
    }
    return { ...d, state: 'unresolved', obligationId: null, reason: null };
  });
  const unresolvedCount = directions.filter((d) => d.state === 'unresolved').length;
  return {
    orderId: row.id,
    matterId,
    reconciled: unresolvedCount === 0,
    unresolvedCount,
    directions,
  };
}

async function loadOrder(scope: ObligationScope, orderId: string) {
  const [found] = await scope.tx
    .select({ order, matterId: proceeding.matterId })
    .from(order)
    .innerJoin(
      proceeding,
      and(eq(proceeding.workspaceId, order.workspaceId), eq(proceeding.id, order.proceedingId)),
    )
    .where(and(eq(order.workspaceId, scope.actor.workspaceId), eq(order.id, orderId)))
    .limit(1);
  if (found === undefined) throw notFound('Order not found');
  await requireMatterFor(scope, found.matterId, 'obligation.read');
  return found;
}

export async function reconcileOrder(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: ReconcileInput,
): Promise<OrderReconciliation> {
  const { orderId } = parseInput(ReconcileInput, input);
  return inObligationScope(deps, actor, async (scope) => {
    const found = await loadOrder(scope, orderId);
    return reconcileIn(scope.tx, scope.actor.workspaceId, found.order, found.matterId);
  });
}

/** Directions still unresolved across the orders of a matter: the brief readiness input (#60). */
export async function countUnresolvedDirections(
  deps: ObligationDeps,
  actor: ObligationActor,
  matterId: string,
): Promise<number> {
  return inObligationScope(deps, actor, async (scope) => {
    await requireMatterFor(scope, matterId, 'obligation.read');
    const orders = await scope.tx
      .select({ order })
      .from(order)
      .innerJoin(
        proceeding,
        and(eq(proceeding.workspaceId, order.workspaceId), eq(proceeding.id, order.proceedingId)),
      )
      .where(
        and(eq(order.workspaceId, scope.actor.workspaceId), eq(proceeding.matterId, matterId)),
      );
    let unresolved = 0;
    for (const { order: row } of orders) {
      unresolved += (await reconcileIn(scope.tx, scope.actor.workspaceId, row, matterId))
        .unresolvedCount;
    }
    return unresolved;
  });
}

/** Mark one direction of an order not applicable, in words. It is a person's decision. */
export async function markDirectionNotApplicable(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: DirectionNotApplicableInput,
): Promise<OrderReconciliation> {
  const data = parseInput(DirectionNotApplicableInput, input);
  return inObligationScope(deps, actor, async (scope) => {
    const found = await loadOrder(scope, data.orderId);
    await requireMatterFor(scope, found.matterId, 'obligation.write');
    const direction = found.order.operativeDirections.find((d) => d.anchorId === data.anchorId);
    if (direction === undefined) throw invalid('anchorId: not a direction of this order');
    const before = await reconcileIn(scope.tx, scope.actor.workspaceId, found.order, found.matterId);
    const existing = before.directions.find((d) => d.anchorId === data.anchorId);
    if (existing !== undefined && existing.state !== 'unresolved') {
      throw conflict('The direction already has an obligation or a decision');
    }
    const [row] = await scope.tx
      .insert(obligation)
      .values({
        workspaceId: scope.actor.workspaceId,
        matterId: found.matterId,
        proceedingId: found.order.proceedingId,
        source: 'order_direction',
        description: direction.text,
        dueDate: null,
        ownerMemberId: scope.memberId,
        status: 'not_applicable',
        closedReasonType: 'not_applicable',
        closedBy: scope.memberId,
        closedAt: scope.now,
        closedNote: data.reason,
        sourceOrderId: found.order.id,
        sourceType: 'manual',
        anchorId: data.anchorId,
        confirmationState: 'confirmed',
      })
      .returning({ id: obligation.id });
    if (row === undefined) throw new Error('markDirectionNotApplicable: insert returned no row');
    await addEvent(scope, row.id, { kind: 'closed', toValue: 'not_applicable', reason: data.reason });
    await audit(scope, 'obligation.direction_not_applicable', { kind: 'order', id: found.order.id });
    return reconcileIn(scope.tx, scope.actor.workspaceId, found.order, found.matterId);
  });
}

