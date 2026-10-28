// `updateObligation` (#67): edit an open obligation. Moving the due date is a reschedule: it needs
// a reason, is kept in `obligation_event` and is not a miss (see `missedObligations`). Only an
// undated task may be left without a date.
import { ObligationPatch } from '@causedeck/validators/obligation';
import { schema } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { conflict, invalid } from '../shared/errors.ts';

import {
  addEvent,
  audit,
  inObligationScope,
  loadObligation,
  parseObligationInput,
  requireOwnerMember,
  writeActionFor,
  type ObligationActor,
  type ObligationDeps,
  type ObligationRow,
} from './context.ts';

const { obligation } = schema;

export async function updateObligation(
  deps: ObligationDeps,
  actor: ObligationActor,
  obligationId: string,
  input: ObligationPatch,
): Promise<ObligationRow> {
  const patch = parseObligationInput(ObligationPatch, input);
  return inObligationScope(deps, actor, async (scope) => {
    const current = await loadObligation(scope, obligationId, 'obligation.read');
    await loadObligation(scope, obligationId, writeActionFor(current.source));
    if (current.status !== 'open')
      throw conflict('A closed obligation cannot be edited; reopen it');
    const rescheduled = patch.dueDate !== undefined && patch.dueDate !== current.dueDate;
    if (patch.dueDate === null && current.source !== 'internal') {
      throw invalid('dueDate: only an undated task may have no due date');
    }
    if (patch.ownerMemberId !== undefined) {
      await requireOwnerMember(scope.tx, scope.actor.workspaceId, patch.ownerMemberId);
    }
    const [row] = await scope.tx
      .update(obligation)
      .set({
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.basis === undefined ? {} : { basis: patch.basis }),
        ...(patch.ownerMemberId === undefined ? {} : { ownerMemberId: patch.ownerMemberId }),
        ...(patch.dueDate === undefined ? {} : { dueDate: patch.dueDate }),
        updatedAt: scope.now,
      })
      .where(
        and(eq(obligation.workspaceId, scope.actor.workspaceId), eq(obligation.id, current.id)),
      )
      .returning();
    if (row === undefined) throw new Error('updateObligation: update returned no row');
    const edited =
      patch.description !== undefined ||
      patch.basis !== undefined ||
      patch.ownerMemberId !== undefined;
    if (edited) await addEvent(scope, row.id, { kind: 'updated' });
    if (rescheduled) {
      await addEvent(scope, row.id, {
        kind: 'rescheduled',
        fromValue: current.dueDate,
        toValue: row.dueDate,
        reason: patch.reason ?? null,
      });
    }
    await audit(scope, rescheduled ? 'obligation.rescheduled' : 'obligation.updated', {
      kind: 'obligation',
      id: row.id,
    });
    return row;
  });
}
