'use server';
// The grounded matter copilot's server action (#1115, ADR 0051). `workspaceAction` checks the zod
// input, session, membership and `matter.read`; the `copilot.enabled` flag is checked here too (a
// flag-off call is NOT_FOUND, like the routes); the core service decides again, meters one question per
// `requestId` and audits it. Used by the matter copilot and the workspace-level one (no `matterId`).
import { z } from 'zod';

import type { Result } from '../../../../../../../lib/safe-action.ts';
import { ActionError } from '../../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../../lib/workspace-action.ts';

import type { CopilotAnswer } from '@causedeck/core/copilot';

function actorOf(ctx: WorkspaceActionCtx) {
  return { workspaceId: ctx.workspaceId, userId: ctx.userId };
}

/** The monthly cap is a refusal the member should read, not a generic failure. */
function readable(error: unknown): unknown {
  if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
    if (error.code === 'RATE_LIMITED') return new ActionError('CONFLICT', error.message);
  }
  return error;
}

const AskInput = WorkspaceScoped.extend({
  question: z.string().trim().min(1).max(4000),
  matterId: z.uuid().optional(),
  /** Makes a retry count once. */
  requestId: z.uuid().optional(),
});

const ask = workspaceAction(
  AskInput,
  async (input, ctx): Promise<CopilotAnswer> => {
    const { isFlagOffError, requireFlag } = await import('@causedeck/flags/server');
    try {
      await requireFlag('copilot.enabled', { workspaceId: ctx.workspaceId, userId: ctx.userId });
    } catch (error) {
      if (isFlagOffError(error)) throw new ActionError('NOT_FOUND', 'Not found');
      throw error;
    }
    const { askCopilot } = await import('@causedeck/core/copilot');
    try {
      return await askCopilot(ctx.tx, actorOf(ctx), {
        question: input.question,
        ...(input.matterId === undefined ? {} : { matterId: input.matterId }),
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      });
    } catch (error) {
      throw readable(error);
    }
  },
  { action: 'matter.read' },
);

export async function askCopilotAction(raw: unknown): Promise<Result<CopilotAnswer>> {
  return ask(raw);
}
