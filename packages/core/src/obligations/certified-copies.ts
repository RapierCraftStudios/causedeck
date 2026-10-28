// Certified copies (#67): applied -> ready -> collected, each step dated and sourced. Applying for
// a copy creates an obligation (source `certified_copy`) due on the follow-up date (seven days
// after the application when none is given, moved to a working day), so the copy shows in the queue
// and the reminder job reminds about it. Recording the copy as collected is the person's act and
// closes that follow-up obligation. Nothing here fetches anything from a court.
import { schema } from '@causedeck/db';
import { CertifiedCopyInput, CopyTransitionInput } from '@causedeck/validators/obligation';
import { and, eq } from 'drizzle-orm';

import { conflict, invalid, notFound } from '../shared/errors.ts';

import { closeInScope } from './close.ts';
import { insertObligation } from './create.ts';
import {
  addEvent,
  audit,
  inObligationScope,
  loadObligation,
  parseObligationInput,
  requireMatterFor,
  type ObligationActor,
  type ObligationDeps,
} from './context.ts';
import { addDays, onOrAfterWorkingDay, type WorkingDayHook } from './due.ts';

const { certifiedCopy, proceeding } = schema;

export type CertifiedCopyRow = typeof certifiedCopy.$inferSelect;

/** Days from the application to the first follow-up when the caller names none. */
export const DEFAULT_COPY_FOLLOW_UP_DAYS = 7;

export async function applyForCertifiedCopy(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: CertifiedCopyInput,
  isWorkingDay?: WorkingDayHook,
): Promise<CertifiedCopyRow> {
  const data = parseObligationInput(CertifiedCopyInput, input);
  return inObligationScope(deps, actor, async (scope) => {
    await requireMatterFor(scope, data.matterId, 'obligation.track');
    const [owning] = await scope.tx
      .select({ id: proceeding.id })
      .from(proceeding)
      .where(
        and(
          eq(proceeding.workspaceId, scope.actor.workspaceId),
          eq(proceeding.id, data.proceedingId),
          eq(proceeding.matterId, data.matterId),
        ),
      )
      .limit(1);
    if (owning === undefined) throw invalid('proceedingId: not a proceeding of this matter');
    const followUp =
      data.followUpOn ??
      onOrAfterWorkingDay(addDays(data.appliedOn, DEFAULT_COPY_FOLLOW_UP_DAYS), isWorkingDay);
    const raised = await insertObligation(scope, {
      matterId: data.matterId,
      proceedingId: data.proceedingId,
      source: 'certified_copy',
      description: data.description,
      dueDate: followUp,
      basis: null,
      ownerMemberId: data.ownerMemberId,
      provenance: data.provenance,
    });
    const p = data.provenance;
    const [row] = await scope.tx
      .insert(certifiedCopy)
      .values({
        workspaceId: scope.actor.workspaceId,
        obligationId: raised.id,
        proceedingId: data.proceedingId,
        appliedOn: data.appliedOn,
        status: 'applied',
        sourceType: p.sourceType,
        sourceRef: p.sourceRef ?? null,
        anchorId: p.anchorId ?? null,
        confidence: p.confidence ?? null,
        confirmationState: raised.confirmationState,
      })
      .returning();
    if (row === undefined) throw new Error('applyForCertifiedCopy: insert returned no row');
    await addEvent(scope, raised.id, { kind: 'copy_applied', toValue: data.appliedOn });
    await audit(scope, 'obligation.copy_applied', { kind: 'certified_copy', id: row.id });
    return row;
  });
}

export async function transitionCertifiedCopy(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: CopyTransitionInput,
): Promise<CertifiedCopyRow> {
  const data = parseObligationInput(CopyTransitionInput, input);
  return inObligationScope(deps, actor, async (scope) => {
    const [found] = await scope.tx
      .select()
      .from(certifiedCopy)
      .where(
        and(
          eq(certifiedCopy.workspaceId, scope.actor.workspaceId),
          eq(certifiedCopy.id, data.certifiedCopyId),
        ),
      )
      .limit(1)
      .for('update');
    if (found === undefined) throw notFound('Certified copy not found');
    const current = await loadObligation(scope, found.obligationId, 'obligation.track');
    const expected = data.to === 'ready' ? 'applied' : 'ready';
    if (found.status !== expected) {
      throw conflict(`A copy moves ${expected} -> ${data.to}; this one is ${found.status}`);
    }
    if (data.on < (data.to === 'ready' ? found.appliedOn : (found.readyOn ?? found.appliedOn))) {
      throw invalid('on: dates only go forward');
    }
    const [row] = await scope.tx
      .update(certifiedCopy)
      .set(
        data.to === 'ready'
          ? {
              status: 'ready',
              readyOn: data.on,
              readySourceRef: data.sourceRef,
              updatedAt: scope.now,
            }
          : {
              status: 'collected',
              collectedOn: data.on,
              collectedSourceRef: data.sourceRef,
              updatedAt: scope.now,
            },
      )
      .where(
        and(eq(certifiedCopy.workspaceId, scope.actor.workspaceId), eq(certifiedCopy.id, found.id)),
      )
      .returning();
    if (row === undefined) throw new Error('transitionCertifiedCopy: update returned no row');
    await addEvent(scope, found.obligationId, {
      kind: data.to === 'ready' ? 'copy_ready' : 'copy_collected',
      fromValue: found.status,
      toValue: data.on,
      reason: data.sourceRef,
    });
    if (data.to === 'collected' && current.status === 'open') {
      await closeInScope(scope, current, { reason: 'task_completed', note: data.sourceRef });
    }
    await audit(
      scope,
      'obligation.copy_transitioned',
      { kind: 'certified_copy', id: row.id },
      {
        to: data.to,
      },
    );
    return row;
  });
}
