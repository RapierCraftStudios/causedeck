/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
'use server';
// Hearing outcome server actions (#62, PRD EX-3). Both go through `workspaceAction`: zod input
// (the validators' schema plus the workspace), session, membership and `matter.write`, so a viewer
// or a clerk without rights gets FORBIDDEN before anything runs. The services in
// `@causedeck/core/hearings` decide again per matter and run on the workspace transaction `ctx.tx`:
// one transaction, all or nothing. The acting user is always the session's, never an input.
// - `confirmOutcomeAction`: the confirmation from the proposal (obligations and tasks decided).
// - `recordManualOutcomeAction`: the L0 path, a typed note and a next date with no proposals.
import { OutcomeConfirmation, ManualOutcomeInput } from '@causedeck/validators/hearing-outcome';
import { revalidatePath } from 'next/cache';

import { ActionError, type Result } from '../../../../../../../lib/safe-action.ts';
import { domainErrorCode } from '../../../../../../../lib/matters/graph-deps.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../../lib/workspace-action.ts';

const NO_EVENTS = {
  emit() {
    // No subscriber consumes hearing events in production yet; the owner's view re-reads on revalidation.
  },
};

export interface ConfirmedOutcomeResult {
  hearingId: string;
  nextDate: string | null;
  obligationIds: string[];
  taskIds: string[];
}

function revalidateOutcome(): void {
  revalidatePath('/w/[slug]/hearings/[hearingId]/outcome', 'page');
}

/** A domain refusal keeps its code; anything else is rethrown for the generic mapping. */
function toActionError(error: unknown): never {
  const code = domainErrorCode(error);
  if (
    error instanceof Error &&
    (code === 'VALIDATION' || code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'CONFLICT')
  ) {
    throw new ActionError(code, error.message);
  }
  throw error;
}

const confirm = workspaceAction(
  WorkspaceScoped.extend(OutcomeConfirmation.shape),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the scope comes from ctx
  async ({ workspaceId: _workspaceId, ...input }, ctx) => {
    const { confirmOutcome } = await import('@causedeck/core/hearings');
    try {
      const result = await confirmOutcome(
        { db: ctx.tx, events: NO_EVENTS },
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        input,
      );
      revalidateOutcome();
      return result;
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'matter.write' },
);

export async function confirmOutcomeAction(raw: unknown): Promise<Result<ConfirmedOutcomeResult>> {
  return confirm(raw);
}

const manual = workspaceAction(
  WorkspaceScoped.extend(ManualOutcomeInput.shape),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the scope comes from ctx
  async ({ workspaceId: _workspaceId, ...input }, ctx) => {
    const { recordManualOutcome } = await import('@causedeck/core/hearings');
    try {
      const result = await recordManualOutcome(
        { db: ctx.tx, events: NO_EVENTS },
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        input,
      );
      revalidateOutcome();
      return result;
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'matter.write' },
);

export async function recordManualOutcomeAction(
  raw: unknown,
): Promise<Result<ConfirmedOutcomeResult>> {
  return manual(raw);
}
