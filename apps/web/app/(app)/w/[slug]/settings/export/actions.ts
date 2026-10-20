'use server';
// Workspace export actions (#305, wiring #301). Both go through `workspaceAction` with the
// owner-only `export.run` policy action (which also refuses an owner without 2FA after the grace,
// #290) and call `@causedeck/core/runtime` on the app db: the core service runs its own
// transaction and records refusals after its rollback, which the action's transaction would undo.
// A missing or stale step-up (passkey or TOTP within 10 minutes, #304) comes back as FORBIDDEN with
// `fieldErrors.stepUp`, so the card asks the owner to confirm and then retries. The export is dark
// until the `workspace.export` flag is on; with it off both actions are NOT_FOUND.
import { headers } from 'next/headers';

import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

import { toExportView, type ExportJobView } from './export-history.tsx';

const STEP_UP_REQUIRED = 'step_up_required';

/** The core step-up refusal as a FORBIDDEN the client can act on; anything else unchanged. */
function stepUpError(error: unknown): unknown {
  if ((error as { reason?: unknown } | null)?.reason === STEP_UP_REQUIRED) {
    return new ActionError('FORBIDDEN', (error as Error).message, { stepUp: ['required'] });
  }
  return error;
}

async function requireExportFlag(ctx: WorkspaceActionCtx): Promise<void> {
  const { isEnabled } = await import('@causedeck/flags/server');
  const on = await isEnabled('workspace.export', {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
  if (!on) throw new ActionError('NOT_FOUND', '');
}

async function requestFields(ctx: WorkspaceActionCtx) {
  const userAgent = (await headers()).get('user-agent') ?? undefined;
  return {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    requestId: ctx.requestId,
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}

const requestExport = workspaceAction(
  WorkspaceScoped,
  async (_input, ctx): Promise<ExportJobView> => {
    await requireExportFlag(ctx);
    const { requestExportFor } = await import('@causedeck/core/runtime');
    try {
      const job = await requestExportFor(
        { ...(await requestFields(ctx)), sessionId: ctx.session.session.id },
        { scope: 'workspace' },
      );
      return toExportView(job);
    } catch (error) {
      throw stepUpError(error);
    }
  },
  { action: 'export.run' },
);

// authz: requireSession + workspace membership + `export.run` (owners only) in workspaceAction;
// core requestExport checks owner and a fresh step-up again.
export async function requestExportAction(raw: unknown): Promise<Result<ExportJobView>> {
  return requestExport(raw);
}

const listExports = workspaceAction(
  WorkspaceScoped,
  async (_input, ctx): Promise<ExportJobView[]> => {
    await requireExportFlag(ctx);
    const { listExportJobsFor } = await import('@causedeck/core/runtime');
    const jobs = await listExportJobsFor(await requestFields(ctx));
    return jobs.map(toExportView);
  },
  { action: 'export.run' },
);

// authz: requireSession + workspace membership + `export.run` (owners only) in workspaceAction;
// core listExportJobs returns the caller's own exports in this workspace only.
export async function listExportsAction(raw: unknown): Promise<Result<ExportJobView[]>> {
  return listExports(raw);
}
