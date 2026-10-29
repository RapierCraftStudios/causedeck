'use server';
// Court-day board server actions (#59). The manual "court is at item N" marker of a hall and date:
// `workspaceAction` validates the input and checks membership, then the core marker service
// (`@causedeck/core/court-day`) runs on the workspace-scoped transaction `ctx.tx` and decides with
// `can('matter.write')`. The input never names a user. A `'use server'` module can only export async
// functions, so each action is a thin wrapper.
import { z } from 'zod';

import { type Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const SetInput = WorkspaceScoped.extend({
  hallId: z.uuid(),
  listDate: day,
  currentItem: z.int().positive(),
  note: z.string().trim().max(500).nullish(),
});
const ClearInput = WorkspaceScoped.extend({ hallId: z.uuid(), listDate: day });

/** What the board shows after a change. */
export interface MarkerView {
  hallId: string;
  listDate: string;
  currentItem: number;
}

const setMarker = workspaceAction(
  SetInput,
  async (input, ctx): Promise<MarkerView> => {
    const { setCurrentItem } = await import('@causedeck/core/court-day');
    const { workspaceId, userId } = ctx;
    const row = await setCurrentItem(
      { db: ctx.tx },
      { workspaceId, userId },
      {
        hallId: input.hallId,
        listDate: input.listDate,
        currentItem: input.currentItem,
        ...(input.note === undefined ? {} : { note: input.note }),
      },
    );
    return { hallId: row.hallId, listDate: row.listDate, currentItem: row.currentItem };
  },
  { action: 'matter.write' },
);

const clearMarker = workspaceAction(
  ClearInput,
  async (input, ctx): Promise<{ hallId: string; listDate: string }> => {
    const { clearCurrentItem } = await import('@causedeck/core/court-day');
    await clearCurrentItem(
      { db: ctx.tx },
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      { hallId: input.hallId, listDate: input.listDate },
    );
    return { hallId: input.hallId, listDate: input.listDate };
  },
  { action: 'matter.write' },
);

export async function setCurrentItemAction(raw: unknown): Promise<Result<MarkerView>> {
  return setMarker(raw);
}

export async function clearCurrentItemAction(
  raw: unknown,
): Promise<Result<{ hallId: string; listDate: string }>> {
  return clearMarker(raw);
}
