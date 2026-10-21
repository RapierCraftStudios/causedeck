'use server';
// Workspace deletion actions (#305, wiring #302). Both go through `workspaceAction` with the
// owner-only `workspace.delete` policy action (which also refuses an owner without 2FA after the
// grace, #290) and call `@causedeck/core/runtime` on the app db: the core service runs its own
// transaction, records refusals after its rollback and emails the owners once it commits. A
// missing or stale step-up (#304) comes back as FORBIDDEN with `fieldErrors.stepUp`, so the dialog
// asks the owner to confirm and then retries; a wrong workspace name is VALIDATION on
// `confirmName`. Both refresh the workspace layout, whose shell shows the cool-off banner.
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

export interface DeletionOutcome {
  jobId: string;
  status: string;
  cooloffUntil: string | null;
}

/** Core lifecycle refusals as failures the dialog can act on; anything else unchanged. */
function lifecycleError(error: unknown): unknown {
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (reason === 'step_up_required') {
    return new ActionError('FORBIDDEN', (error as Error).message, { stepUp: ['required'] });
  }
  if (reason === 'CONFIRM_NAME_MISMATCH') {
    return new ActionError('VALIDATION', (error as Error).message, { confirmName: ['mismatch'] });
  }
  return error;
}

async function deletionCtx(ctx: WorkspaceActionCtx) {
  const userAgent = (await headers()).get('user-agent') ?? undefined;
  return {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    sessionId: ctx.session.session.id,
    requestId: ctx.requestId,
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}

function outcome(job: { id: string; status: string; cooloffUntil: Date | null }): DeletionOutcome {
  return {
    jobId: job.id,
    status: job.status,
    cooloffUntil: job.cooloffUntil?.toISOString() ?? null,
  };
}

function refresh(): void {
  revalidatePath('/w/[slug]', 'layout');
}

const RequestDeletion = WorkspaceScoped.extend({ confirmName: z.string().max(200) });

const requestDeletion = workspaceAction(
  RequestDeletion,
  async ({ confirmName }, ctx): Promise<DeletionOutcome> => {
    const { requestWorkspaceDeletionFor } = await import('@causedeck/core/runtime');
    try {
      const job = await requestWorkspaceDeletionFor(await deletionCtx(ctx), { confirmName });
      refresh();
      return outcome(job);
    } catch (error) {
      throw lifecycleError(error);
    }
  },
  { action: 'workspace.delete' },
);

// authz: requireSession + workspace membership + `workspace.delete` (owners only) in
// workspaceAction; core requestWorkspaceDeletion checks owner, fresh step-up and the name again.
export async function requestWorkspaceDeletionAction(
  raw: unknown,
): Promise<Result<DeletionOutcome>> {
  return requestDeletion(raw);
}

const CancelDeletion = WorkspaceScoped.extend({ jobId: z.uuid() });

const cancelDeletion = workspaceAction(
  CancelDeletion,
  async ({ jobId }, ctx): Promise<DeletionOutcome> => {
    const { cancelWorkspaceDeletionFor } = await import('@causedeck/core/runtime');
    try {
      const job = await cancelWorkspaceDeletionFor(await deletionCtx(ctx), jobId);
      refresh();
      return outcome(job);
    } catch (error) {
      throw lifecycleError(error);
    }
  },
  { action: 'workspace.delete' },
);

// authz: requireSession + workspace membership + `workspace.delete` (any owner) in workspaceAction;
// core cancelWorkspaceDeletion checks owner, fresh step-up and that the job is this workspace's.
export async function cancelWorkspaceDeletionAction(
  raw: unknown,
): Promise<Result<DeletionOutcome>> {
  return cancelDeletion(raw);
}
