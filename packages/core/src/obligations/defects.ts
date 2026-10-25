// Registry defects (#67; ADR 0016, ADR 0037). `raiseDefect` moves the proceeding to `defects`
// through `transitionProceeding` (the only writer of `proceeding.state`) and creates the defect
// with its cure-deadline obligation (source `registry_defect`). `cureDefect` records the cure and
// closes that obligation, a person's act. `representFiling` moves the proceeding to `re_presented`.
// `allocateRegistryNumber` stores the SR (Madras) or FR (Karnataka) number the registry allocated on
// the proceeding; it says nothing about the court's status. Raising a defect and re-presenting
// need `matter.write` on the matter, because the state machine checks it.
import { schema } from '@causedeck/db';
import {
  AllocateRegistryNumberInput,
  CureDefectInput,
  DefectInput,
  RepresentFilingInput,
} from '@causedeck/validators/obligation';
import { and, eq } from 'drizzle-orm';

import { conflict, invalid, notFound } from '../shared/errors.ts';
import { transitionProceeding } from '../matter-graph/index.ts';

import { closeInScope } from './close.ts';
import { insertObligation } from './create.ts';
import {
  addEvent,
  audit,
  inObligationScope,
  loadObligation,
  parseInput,
  requireMatterFor,
  type ObligationActor,
  type ObligationDeps,
  type ObligationScope,
} from './context.ts';

const { defect, proceeding } = schema;

export type DefectRow = typeof defect.$inferSelect;

const noEvents = { emit() {} };

async function matterOf(scope: ObligationScope, proceedingId: string): Promise<string> {
  const [row] = await scope.tx
    .select({ matterId: proceeding.matterId })
    .from(proceeding)
    .where(
      and(eq(proceeding.workspaceId, scope.actor.workspaceId), eq(proceeding.id, proceedingId)),
    )
    .limit(1);
  if (row === undefined) throw notFound('Proceeding not found');
  return row.matterId;
}

export async function raiseDefect(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: DefectInput,
): Promise<DefectRow> {
  const data = parseInput(DefectInput, input);
  if (data.cureBy < data.raisedOn) throw invalid('cureBy: before the day the defect was raised');
  return inObligationScope(deps, actor, async (scope) => {
    const matterId = await matterOf(scope, data.proceedingId);
    await requireMatterFor(scope, matterId, 'obligation.track');
    await transitionProceeding(
      { db: scope.tx, events: deps.events ?? noEvents, now: () => scope.now },
      actor,
      {
        proceedingId: data.proceedingId,
        to: 'defects',
        reason: data.description,
        cureDeadline: data.cureBy,
        provenance: {
          sourceType: data.provenance.sourceType,
          sourceRef: data.provenance.sourceRef ?? null,
          anchorId: data.provenance.anchorId ?? null,
        },
      },
    );
    const raised = await insertObligation(scope, {
      matterId,
      proceedingId: data.proceedingId,
      source: 'registry_defect',
      description: data.description,
      dueDate: data.cureBy,
      basis: null,
      ownerMemberId: data.ownerMemberId,
      provenance: data.provenance,
    });
    const p = data.provenance;
    const [row] = await scope.tx
      .insert(defect)
      .values({
        workspaceId: scope.actor.workspaceId,
        obligationId: raised.id,
        proceedingId: data.proceedingId,
        raisedOn: data.raisedOn,
        cureBy: data.cureBy,
        description: data.description,
        sourceType: p.sourceType,
        sourceRef: p.sourceRef ?? null,
        anchorId: p.anchorId ?? null,
        confidence: p.confidence ?? null,
        confirmationState: raised.confirmationState,
      })
      .returning();
    if (row === undefined) throw new Error('raiseDefect: insert returned no row');
    await addEvent(scope, raised.id, { kind: 'defect_raised', toValue: data.cureBy });
    await audit(scope, 'obligation.defect_raised', { kind: 'defect', id: row.id });
    return row;
  });
}

export async function cureDefect(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: CureDefectInput,
): Promise<DefectRow> {
  const data = parseInput(CureDefectInput, input);
  return inObligationScope(deps, actor, async (scope) => {
    const [found] = await scope.tx
      .select()
      .from(defect)
      .where(and(eq(defect.workspaceId, scope.actor.workspaceId), eq(defect.id, data.defectId)))
      .limit(1)
      .for('update');
    if (found === undefined) throw notFound('Defect not found');
    const current = await loadObligation(scope, found.obligationId, 'obligation.track');
    if (found.curedOn !== null) throw conflict('The defect is already cured');
    if (data.curedOn < found.raisedOn) throw invalid('curedOn: before the defect was raised');
    const [row] = await scope.tx
      .update(defect)
      .set({ curedOn: data.curedOn, updatedAt: scope.now })
      .where(and(eq(defect.workspaceId, scope.actor.workspaceId), eq(defect.id, found.id)))
      .returning();
    if (row === undefined) throw new Error('cureDefect: update returned no row');
    if (current.status === 'open') {
      await closeInScope(scope, current, {
        reason: 'task_completed',
        ...(data.note === undefined ? {} : { note: data.note }),
      });
    }
    await addEvent(scope, found.obligationId, { kind: 'defect_cured', toValue: data.curedOn });
    await audit(scope, 'obligation.defect_cured', { kind: 'defect', id: row.id });
    return row;
  });
}

async function storeNumbers(
  scope: ObligationScope,
  proceedingId: string,
  numbers: { srNo?: string | undefined; frNo?: string | undefined },
): Promise<void> {
  if (numbers.srNo === undefined && numbers.frNo === undefined) return;
  await scope.tx
    .update(proceeding)
    .set({
      ...(numbers.srNo === undefined ? {} : { srNo: numbers.srNo }),
      ...(numbers.frNo === undefined ? {} : { frNo: numbers.frNo }),
      updatedAt: scope.now,
    })
    .where(
      and(eq(proceeding.workspaceId, scope.actor.workspaceId), eq(proceeding.id, proceedingId)),
    );
}

export async function representFiling(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: RepresentFilingInput,
): Promise<{ proceedingId: string; state: 're_presented' }> {
  const data = parseInput(RepresentFilingInput, input);
  return inObligationScope(deps, actor, async (scope) => {
    const matterId = await matterOf(scope, data.proceedingId);
    await requireMatterFor(scope, matterId, 'obligation.track');
    await transitionProceeding(
      { db: scope.tx, events: deps.events ?? noEvents, now: () => scope.now },
      actor,
      {
        proceedingId: data.proceedingId,
        to: 're_presented',
        ...(data.reason === undefined ? {} : { reason: data.reason }),
      },
    );
    await storeNumbers(scope, data.proceedingId, data);
    await audit(scope, 'obligation.represented', { kind: 'proceeding', id: data.proceedingId });
    return { proceedingId: data.proceedingId, state: 're_presented' };
  });
}

export async function allocateRegistryNumber(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: AllocateRegistryNumberInput,
): Promise<void> {
  const data = parseInput(AllocateRegistryNumberInput, input);
  return inObligationScope(deps, actor, async (scope) => {
    const matterId = await matterOf(scope, data.proceedingId);
    await requireMatterFor(scope, matterId, 'obligation.track');
    await storeNumbers(scope, data.proceedingId, data);
    await audit(scope, 'obligation.registry_number', { kind: 'proceeding', id: data.proceedingId });
  });
}
