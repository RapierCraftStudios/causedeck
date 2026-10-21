// The proceeding state machine (#363, part 2 of #33; ADR 0016): the only writer of
// `proceeding.state`. The transition table allows exactly filed -> sr_fr, sr_fr -> defects | numbered,
// defects -> re_presented, re_presented -> defects | numbered, numbered -> disposed and the reopen
// disposed -> numbered, which needs a non-blank reason; anything else is `InvalidTransitionError`.
// Numbering sets `number` and `year` in the same call and leaves the SR, FR, diary and filing
// numbers as they were (history is not erased). Every transition stamps `state_changed_at`, appends
// one `proceeding_state_change` row and emits `proceeding.state_changed`; a state change is never
// `proposed`, since its actor confirms it. Access follows the proceeding's matter (`matter.write`);
// another workspace's proceeding is NOT_FOUND.
import { schema } from '@causedeck/db';
import type { ProceedingState } from '@causedeck/db/schema';
import { TransitionProceedingInput } from '@causedeck/validators/matter-graph-inputs';
import { and, eq } from 'drizzle-orm';

import { activeMember } from '../shared/membership.ts';
import { invalid, notFound } from '../shared/errors.ts';

import {
  inGraphScope,
  parseInput,
  pgError,
  requireMatter,
  type GraphActor,
  type MatterGraphDeps,
} from './context.ts';
import { expandYear, normaliseCaseNumber } from './duplicates.ts';
import { graphNotFound, InvalidTransitionError } from './errors.ts';
import { proceedingWriteError, type ProceedingRow } from './proceedings.ts';

const { member, proceeding, proceedingStateChange } = schema;

export type ProceedingStateChangeRow = typeof proceedingStateChange.$inferSelect;

/** The states each state may move to (ADR 0016). */
export const PROCEEDING_TRANSITIONS: Readonly<Record<ProceedingState, readonly ProceedingState[]>> =
  Object.freeze({
    filed: Object.freeze(['sr_fr'] as const),
    sr_fr: Object.freeze(['defects', 'numbered'] as const),
    defects: Object.freeze(['re_presented'] as const),
    re_presented: Object.freeze(['defects', 'numbered'] as const),
    numbered: Object.freeze(['disposed'] as const),
    disposed: Object.freeze(['numbered'] as const),
  });

/**
 * Throws `InvalidTransitionError` unless the table allows `from` -> `to`; a reopen
 * (`disposed` -> `numbered`) also needs a non-blank `reason`.
 */
export function assertTransition(
  from: ProceedingState,
  to: ProceedingState,
  reason?: string | null,
): void {
  if (!PROCEEDING_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError(from, to);
  if (from === 'disposed' && (reason == null || reason.trim() === '')) {
    throw new InvalidTransitionError(from, to, 'Reopening a disposed proceeding needs a reason');
  }
}

/** What `transitionProceeding` wrote: the updated proceeding and its history row. */
export interface ProceedingTransition {
  proceeding: ProceedingRow;
  stateChange: ProceedingStateChangeRow;
}

/**
 * Move a proceeding to `to` (see the table above). The proceeding row is locked first, so two
 * concurrent transitions cannot both start from the same state. Emits `proceeding.state_changed`.
 */
export async function transitionProceeding(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: TransitionProceedingInput,
): Promise<ProceedingTransition> {
  const data = parseInput(TransitionProceedingInput, input);
  const provenance = data.provenance ?? { sourceType: 'manual' as const };
  const confirmationState = provenance.confirmationState ?? 'confirmed';
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId, userId } = scope.actor;
    const [current] = await tx
      .select()
      .from(proceeding)
      .where(and(eq(proceeding.workspaceId, workspaceId), eq(proceeding.id, data.proceedingId)))
      .limit(1)
      .for('update');
    if (current === undefined) throw graphNotFound('proceeding');
    const owning = await requireMatter(scope, current.matterId, 'matter.write');
    assertTransition(current.state, data.to, data.reason);
    const [self] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId), activeMember))
      .limit(1);
    if (self === undefined) throw notFound('Matter not found');

    const at = new Date();
    const numbering =
      data.to === 'numbered' && data.number !== undefined && data.year !== undefined
        ? { number: normaliseCaseNumber(data.number), year: expandYear(data.year) }
        : {};
    let row: ProceedingRow | undefined;
    try {
      [row] = await tx
        .update(proceeding)
        .set({ state: data.to, stateChangedAt: at, updatedAt: at, ...numbering })
        .where(and(eq(proceeding.workspaceId, workspaceId), eq(proceeding.id, current.id)))
        .returning();
    } catch (error) {
      throw proceedingWriteError(error);
    }
    if (!row) throw new Error('transitionProceeding: update returned no row');

    let change: ProceedingStateChangeRow | undefined;
    try {
      [change] = await tx
        .insert(proceedingStateChange)
        .values({
          workspaceId,
          proceedingId: current.id,
          fromState: current.state,
          toState: data.to,
          reason: data.reason ?? null,
          actorMemberId: self.id,
          cureDeadline: data.cureDeadline ?? null,
          changedAt: at,
          sourceType: provenance.sourceType,
          sourceRef: provenance.sourceRef ?? null,
          anchorId: provenance.anchorId ?? null,
          confidence: provenance.confidence ?? null,
          confirmationState,
          ...(provenance.capturedAt === undefined ? {} : { capturedAt: provenance.capturedAt }),
        })
        .returning();
    } catch (error) {
      const { code, constraint } = pgError(error);
      if (code === '23503' && constraint === 'proceeding_state_change_anchor_fk') {
        throw invalid('provenance.anchorId: anchor not found');
      }
      throw error;
    }
    if (!change) throw new Error('transitionProceeding: insert returned no row');

    scope.emit({
      type: 'proceeding.state_changed',
      workspaceId,
      actorUserId: userId,
      matterId: owning.id,
      sensitive: owning.sensitive,
      proceedingId: current.id,
      stateChangeId: change.id,
      from: change.fromState,
      to: change.toState,
      reason: change.reason,
      actor: { userId, memberId: self.id },
      provenance: {
        sourceType: change.sourceType,
        sourceRef: change.sourceRef,
        anchorId: change.anchorId,
        confidence: change.confidence,
        confirmationState: change.confirmationState,
      },
      ...(change.cureDeadline === null ? {} : { cureDeadline: change.cureDeadline }),
    });
    return { proceeding: row, stateChange: change };
  });
}
