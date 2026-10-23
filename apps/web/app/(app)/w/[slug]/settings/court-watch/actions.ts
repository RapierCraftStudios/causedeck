'use server';
// Court watch actions (#482): a member's watches on the Karnataka HC public cause list. Each goes
// through `workspaceAction` with the `matter.write` policy action (the member may stage proposals)
// and calls `@causedeck/core/court` on the action's workspace transaction, scoped to the member.
// Dark until the `court.khc_a2` flag is on for the workspace: with it off every action is NOT_FOUND.
import { z } from 'zod';

import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

export interface CourtWatchView {
  id: string;
  kind: 'name' | 'brn';
  value: string;
}

async function requireWatchFlag(ctx: WorkspaceActionCtx): Promise<void> {
  const { isEnabled } = await import('@causedeck/flags/server');
  const on = await isEnabled('court.khc_a2', { workspaceId: ctx.workspaceId, userId: ctx.userId });
  if (!on) throw new ActionError('NOT_FOUND', '');
}

const actorOf = (ctx: WorkspaceActionCtx) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

const toView = (row: { id: string; kind: 'name' | 'brn'; value: string }): CourtWatchView => ({
  id: row.id,
  kind: row.kind,
  value: row.value,
});

const AddInput = WorkspaceScoped.extend({
  kind: z.enum(['name', 'brn']),
  value: z.string().min(1).max(200),
});
const RemoveInput = WorkspaceScoped.extend({ watchId: z.uuid() });

const listWatches = workspaceAction(
  WorkspaceScoped,
  async (_input, ctx): Promise<CourtWatchView[]> => {
    await requireWatchFlag(ctx);
    const { listCauseListWatches } = await import('@causedeck/core/court');
    return (await listCauseListWatches({ db: ctx.tx }, actorOf(ctx))).map(toView);
  },
  { action: 'matter.write' },
);

// authz: requireSession + workspace membership + `matter.write` in workspaceAction; core lists the
// caller's own watches in this workspace only.
export async function listCourtWatchesAction(raw: unknown): Promise<Result<CourtWatchView[]>> {
  return listWatches(raw);
}

const addWatch = workspaceAction(
  AddInput,
  async (input, ctx): Promise<CourtWatchView> => {
    await requireWatchFlag(ctx);
    const { addCauseListWatch } = await import('@causedeck/core/court');
    const row = await addCauseListWatch({ db: ctx.tx }, actorOf(ctx), {
      kind: input.kind,
      value: input.value,
    });
    return toView(row);
  },
  { action: 'matter.write' },
);

// authz: requireSession + workspace membership + `matter.write` in workspaceAction; the watch is
// written under the caller's own workspace and user.
export async function addCourtWatchAction(raw: unknown): Promise<Result<CourtWatchView>> {
  return addWatch(raw);
}

const removeWatch = workspaceAction(
  RemoveInput,
  async (input, ctx): Promise<{ removed: true }> => {
    await requireWatchFlag(ctx);
    const { removeCauseListWatch } = await import('@causedeck/core/court');
    await removeCauseListWatch({ db: ctx.tx }, actorOf(ctx), input.watchId);
    return { removed: true };
  },
  { action: 'matter.write' },
);

// authz: requireSession + workspace membership + `matter.write` in workspaceAction; core removes
// only the caller's own watch in this workspace (another's id is NOT_FOUND).
export async function removeCourtWatchAction(raw: unknown): Promise<Result<{ removed: true }>> {
  return removeWatch(raw);
}
