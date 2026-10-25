// `closeObligation` and `reopenObligation` (#67): closure is always a person's act with a reason
// type (`task_completed`, `lawyer_action`, `not_applicable`) and, for `not_applicable`, words. The
// database holds the same rule (`obligation_closure_chk`). Nothing closes an obligation on its
// own. A reopen keeps the history: the closure stays in `obligation_event`.
import { schema } from '@causedeck/db';
import { CloseInput, ReopenInput } from '@causedeck/validators/obligation';
import { and, eq } from 'drizzle-orm';

import { conflict } from '../shared/errors.ts';

import {
  addEvent,
  audit,
  inObligationScope,
  loadObligation,
  parseInput,
  writeActionFor,
  type ObligationActor,
  type ObligationDeps,
  type ObligationRow,
  type ObligationScope,
} from './context.ts';

const { obligation } = schema;

/** Close `current` inside `scope` (shared with defect cures and copy collection). */
export async function closeInScope(
  scope: ObligationScope,
  current: ObligationRow,
  input: CloseInput,
): Promise<ObligationRow> {
  const data = parseInput(CloseInput, input);
  if (current.status !== 'open') throw conflict('The obligation is already closed');
  const [row] = await scope.tx
    .update(obligation)
    .set({
      status: data.reason === 'not_applicable' ? 'not_applicable' : 'done',
      closedReasonType: data.reason,
      closedBy: scope.memberId,
      closedAt: scope.now,
      closedNote: data.note ?? null,
      updatedAt: scope.now,
    })
    .where(and(eq(obligation.workspaceId, scope.actor.workspaceId), eq(obligation.id, current.id)))
    .returning();
  if (row === undefined) throw new Error('closeObligation: update returned no row');
  await addEvent(scope, row.id, {
    kind: 'closed',
    toValue: data.reason,
    reason: data.note ?? null,
  });
  await audit(
    scope,
    'obligation.closed',
    { kind: 'obligation', id: row.id },
    { reason: data.reason },
  );
  return row;
}

export async function closeObligation(
  deps: ObligationDeps,
  actor: ObligationActor,
  obligationId: string,
  input: CloseInput,
): Promise<ObligationRow> {
  const data = parseInput(CloseInput, input);
  return inObligationScope(deps, actor, async (scope) => {
    const current = await loadObligation(scope, obligationId, 'obligation.read');
    await loadObligation(scope, obligationId, writeActionFor(current.source));
    return closeInScope(scope, current, data);
  });
}

export async function reopenObligation(
  deps: ObligationDeps,
  actor: ObligationActor,
  obligationId: string,
  input: ReopenInput,
): Promise<ObligationRow> {
  const data = parseInput(ReopenInput, input);
  return inObligationScope(deps, actor, async (scope) => {
    const current = await loadObligation(scope, obligationId, 'obligation.read');
    await loadObligation(scope, obligationId, writeActionFor(current.source));
    if (current.status === 'open') throw conflict('The obligation is already open');
    const [row] = await scope.tx
      .update(obligation)
      .set({
        status: 'open',
        closedReasonType: null,
        closedBy: null,
        closedAt: null,
        closedNote: null,
        updatedAt: scope.now,
      })
      .where(
        and(eq(obligation.workspaceId, scope.actor.workspaceId), eq(obligation.id, current.id)),
      )
      .returning();
    if (row === undefined) throw new Error('reopenObligation: update returned no row');
    await addEvent(scope, row.id, {
      kind: 'reopened',
      fromValue: current.closedReasonType,
      reason: data.reason,
    });
    await audit(scope, 'obligation.reopened', { kind: 'obligation', id: row.id });
    return row;
  });
}
