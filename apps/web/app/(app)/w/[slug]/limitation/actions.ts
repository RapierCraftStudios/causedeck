'use server';
// Limitation server actions (#941, #84 part 3). Each goes through `workspaceAction`: zod input,
// `requireSession`, membership and the advocate-level policy action (`limitation.write`), so a
// clerk, junior or viewer gets FORBIDDEN before anything runs. The legal-gated `limitation.enabled`
// flag is read first: off means NOT_FOUND, as if the feature did not exist (core would answer
// FORBIDDEN, which would reveal it). A date is only ever computed from a reviewed rule.
// - `computeLimitationAction`: propose the last day to file for a matter under a reviewed rule.
// - `confirmLimitationAction`: confirm a proposal, which creates the rule obligation.
import { ComputationInput } from '@causedeck/validators/limitation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { limitationDeps } from '../../../../../lib/limitation/limitation-deps.ts';
import { ActionError, type Result } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

function actorOf(ctx: WorkspaceActionCtx) {
  return { workspaceId: ctx.workspaceId, userId: ctx.userId };
}

async function requireFlag(ctx: WorkspaceActionCtx): Promise<void> {
  const { isEnabled } = await import('@causedeck/flags/server');
  const on = await isEnabled('limitation.enabled', {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
  if (!on) throw new ActionError('NOT_FOUND', '');
}

/** Core's `LimitationDisabledError` (its own flag read) is a refusal: FORBIDDEN, a backstop. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.name === 'LimitationDisabledError') {
      throw new ActionError('FORBIDDEN', '');
    }
    throw error;
  }
}

function revalidateLimitation(): void {
  revalidatePath('/w/[slug]/limitation', 'page');
}

/** What a mutation returns: ids and the due date, never the rule inputs. */
export interface SavedComputation {
  id: string;
  expiresOn: string;
}

const OPTIONS = { action: 'limitation.write' } as const;

const compute = workspaceAction(
  WorkspaceScoped.extend(ComputationInput.shape),
  async (input, ctx): Promise<SavedComputation> => {
    await requireFlag(ctx);
    const { computeLimitation } = await import('@causedeck/core/limitation');
    const row = await guarded(() =>
      computeLimitation(limitationDeps(ctx.tx), actorOf(ctx), {
        matterId: input.matterId,
        ruleCode: input.ruleCode,
        startDate: input.startDate,
        excludedDays: input.excludedDays,
      }),
    );
    revalidateLimitation();
    return { id: row.id, expiresOn: row.expiresOn };
  },
  OPTIONS,
);

export async function computeLimitationAction(raw: unknown): Promise<Result<SavedComputation>> {
  return compute(raw);
}

const confirm = workspaceAction(
  WorkspaceScoped.extend({ computationId: z.uuid() }),
  async (input, ctx): Promise<SavedComputation> => {
    await requireFlag(ctx);
    const { confirmLimitation } = await import('@causedeck/core/limitation');
    const row = await guarded(() =>
      confirmLimitation(limitationDeps(ctx.tx), actorOf(ctx), {
        computationId: input.computationId,
      }),
    );
    revalidateLimitation();
    return { id: row.computationId, expiresOn: row.dueDate };
  },
  OPTIONS,
);

export async function confirmLimitationAction(raw: unknown): Promise<Result<SavedComputation>> {
  return confirm(raw);
}
