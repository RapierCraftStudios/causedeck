'use server';
// News digest preferences server action (#481). Goes through `workspaceAction` (zod input, session,
// membership). The input never names a user: the signed-in member saves their own practice areas,
// forums and digest time, on the workspace-scoped transaction `ctx.tx`.
import { z } from 'zod';

import { ActionError, type Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

export interface NewsPrefView {
  practiceAreas: string[];
  forums: string[];
  digestTime: string;
}

const SaveInput = WorkspaceScoped.extend({
  practiceAreas: z.array(z.string().max(40)).max(40),
  forums: z.array(z.string().max(40)).max(40),
  digestTime: z.string().regex(/^\d{2}:\d{2}$/),
});

const save = workspaceAction(SaveInput, async (input, ctx) => {
  const { NewsError, setNewsPref } = await import('@causedeck/core/news');
  try {
    const pref = await setNewsPref(
      { db: ctx.tx, workspaceId: ctx.workspaceId },
      {
        userId: ctx.userId,
        practiceAreas: input.practiceAreas,
        forums: input.forums,
        digestTime: input.digestTime,
      },
    );
    return {
      practiceAreas: pref.practiceAreas,
      forums: pref.forums,
      digestTime: pref.digestTime,
    } satisfies NewsPrefView;
  } catch (error) {
    if (error instanceof NewsError) {
      throw new ActionError(error.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'VALIDATION', error.message);
    }
    throw error;
  }
});

// A `'use server'` module may only export async functions, so the action is wrapped.
export async function saveNewsPreferencesAction(raw: unknown): Promise<Result<NewsPrefView>> {
  return save(raw);
}
