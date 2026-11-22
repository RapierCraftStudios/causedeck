'use server';
// Drafting studio authority actions (#1144, slice 3 of #1118). Both go through `workspaceAction`
// (strict zod input, session, membership, the policy action asserted by `guard`), check the
// `copilot.enabled` flag themselves (a flag-off call is NOT_FOUND, like `askCopilotAction`), and the
// core services decide again as the member: a clerk is FORBIDDEN, another workspace's draft is
// NOT_FOUND.
// - `proposeAuthoritiesAction`: verified corpus authorities for one block of the latest version;
//   writes nothing (one metered copilot question per `requestId`).
// - `insertAuthorityAction`: re-verifies the sent candidate against the stored judgment text and saves
//   it as a new paragraph in the next version. The client's quote is never trusted.
// No draft or judgment text reaches a log.
import type { InsertAuthorityResult, ProposeAuthoritiesResult } from '@causedeck/core/drafting';
import { z } from 'zod';

import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

export interface InsertedAuthority {
  versionId: string;
  versionNo: number;
  blockId: string;
}

const pinNo = z.number().int().positive().max(1_000_000);

const ProposeAuthorities = WorkspaceScoped.extend({
  draftId: z.uuid(),
  blockId: z.string().min(1).max(200),
  /** Makes a retry count once. */
  requestId: z.uuid().optional(),
}).strict();

const InsertAuthority = WorkspaceScoped.extend({
  draftId: z.uuid(),
  versionId: z.uuid(),
  afterBlockId: z.string().min(1).max(200),
  candidateRef: z
    .object({
      judgmentId: z.uuid(),
      quote: z.string().min(1).max(2000),
      para: pinNo.optional(),
      page: pinNo.optional(),
    })
    .strict(),
}).strict();

const actorOf = (ctx: WorkspaceActionCtx) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

async function requireCopilot(ctx: WorkspaceActionCtx): Promise<void> {
  const { isFlagOffError, requireFlag } = await import('@causedeck/flags/server');
  try {
    await requireFlag('copilot.enabled', actorOf(ctx));
  } catch (error) {
    if (isFlagOffError(error)) throw new ActionError('NOT_FOUND', 'Not found');
    throw error;
  }
}

/** Core domain errors become the client-safe codes; anything else stays an INTERNAL failure. */
function rethrow(error: unknown): never {
  if (error instanceof ActionError) throw error;
  // The monthly copilot cap is a refusal the member should read, not a generic failure.
  if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
    if (error.code === 'RATE_LIMITED') throw new ActionError('CONFLICT', error.message);
  }
  const code = domainErrorCode(error);
  if (
    code === 'NOT_FOUND' ||
    code === 'FORBIDDEN' ||
    code === 'VALIDATION' ||
    code === 'CONFLICT'
  ) {
    throw new ActionError(code, '');
  }
  throw error;
}

const propose = workspaceAction(
  ProposeAuthorities,
  async (input, ctx): Promise<ProposeAuthoritiesResult> => {
    await requireCopilot(ctx);
    const { proposeAuthorities } = await import('@causedeck/core/drafting');
    try {
      return await proposeAuthorities({ db: ctx.tx }, actorOf(ctx), {
        draftId: input.draftId,
        blockId: input.blockId,
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      });
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.read' },
);

export async function proposeAuthoritiesAction(
  raw: unknown,
): Promise<Result<ProposeAuthoritiesResult>> {
  return propose(raw);
}

const insert = workspaceAction(
  InsertAuthority,
  async (input, ctx): Promise<InsertedAuthority> => {
    await requireCopilot(ctx);
    const { insertAuthority } = await import('@causedeck/core/drafting');
    try {
      const { candidateRef: ref } = input;
      const result: InsertAuthorityResult = await insertAuthority({ db: ctx.tx }, actorOf(ctx), {
        draftId: input.draftId,
        versionId: input.versionId,
        afterBlockId: input.afterBlockId,
        candidateRef: {
          judgmentId: ref.judgmentId,
          quote: ref.quote,
          ...(ref.para === undefined ? {} : { para: ref.para }),
          ...(ref.page === undefined ? {} : { page: ref.page }),
        },
      });
      return {
        versionId: result.version.id,
        versionNo: result.version.versionNo,
        blockId: result.blockId,
      };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.write' },
);

export async function insertAuthorityAction(raw: unknown): Promise<Result<InsertedAuthority>> {
  return insert(raw);
}
