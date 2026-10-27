'use server';
// Live fact-check actions for the drafting studio (#914, part 2 of #170). Each goes through
// `workspaceAction` (zod input, session, membership, the policy action asserted by `guard`), and the
// drafting services decide again as the member: a clerk is FORBIDDEN, another workspace's draft is
// NOT_FOUND.
// - `runFactCheckAction`: verdicts for one version against the matter record.
// - `ignoreFactAction` / `markAssertionAction`: the lawyer's per-matter decision on one claim; the
//   assertion records who.
// - `acknowledgeFactCheckAction`: the typed, audited acknowledgement that lets an export through.
// - `recordFactFixAction`: the activity-feed entry once a fix saved a new version.
// Nothing here writes, suggests or replaces a claim or an authority. No draft text reaches a log.
import type { FactCheckResult, FactFixResult } from '@causedeck/core/drafting';
import { FACT_CLAIM_KEY_MAX } from '@causedeck/validators/factcheck';
import { z } from 'zod';

import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

const VersionScoped = WorkspaceScoped.extend({ draftVersionId: z.uuid() });

const ClaimDecision = VersionScoped.extend({
  claimKey: z.string().trim().min(3).max(FACT_CLAIM_KEY_MAX),
});

const AcknowledgeFactCheck = VersionScoped.extend({
  reason: z.string().trim().min(3).max(500),
  confirm: z.literal(true),
});

const RecordFix = WorkspaceScoped.extend({ fromVersionId: z.uuid(), toVersionId: z.uuid() });

/** Core domain errors become the client-safe codes; anything else stays an INTERNAL failure. */
function rethrow(error: unknown): never {
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

const actorOf = (ctx: { workspaceId: string; userId: string }) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

const runCheck = workspaceAction(
  VersionScoped,
  async (input, ctx): Promise<FactCheckResult> => {
    const { runFactCheck } = await import('@causedeck/core/drafting');
    try {
      return await runFactCheck({ db: ctx.tx }, actorOf(ctx), {
        draftVersionId: input.draftVersionId,
      });
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.read' },
);

export async function runFactCheckAction(raw: unknown): Promise<Result<FactCheckResult>> {
  return runCheck(raw);
}

const ignore = workspaceAction(
  ClaimDecision,
  async (input, ctx): Promise<{ claimKey: string }> => {
    const { ignoreForMatter } = await import('@causedeck/core/drafting');
    try {
      const { claimKey } = await ignoreForMatter({ db: ctx.tx }, actorOf(ctx), {
        draftVersionId: input.draftVersionId,
        claimKey: input.claimKey,
      });
      return { claimKey };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.write' },
);

export async function ignoreFactAction(raw: unknown): Promise<Result<{ claimKey: string }>> {
  return ignore(raw);
}

const assertClaim = workspaceAction(
  ClaimDecision,
  async (input, ctx): Promise<{ claimKey: string }> => {
    const { markAsAssertion } = await import('@causedeck/core/drafting');
    try {
      const { claimKey } = await markAsAssertion({ db: ctx.tx }, actorOf(ctx), {
        draftVersionId: input.draftVersionId,
        claimKey: input.claimKey,
      });
      return { claimKey };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.write' },
);

export async function markAssertionAction(raw: unknown): Promise<Result<{ claimKey: string }>> {
  return assertClaim(raw);
}

const acknowledge = workspaceAction(
  AcknowledgeFactCheck,
  async (input, ctx): Promise<{ unresolved: number }> => {
    const { acknowledgeFactCheck } = await import('@causedeck/core/drafting');
    try {
      const { unresolved } = await acknowledgeFactCheck({ db: ctx.tx }, actorOf(ctx), {
        draftVersionId: input.draftVersionId,
        reason: input.reason,
        confirm: input.confirm,
      });
      return { unresolved };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.export' },
);

export async function acknowledgeFactCheckAction(
  raw: unknown,
): Promise<Result<{ unresolved: number }>> {
  return acknowledge(raw);
}

const recordFix = workspaceAction(
  RecordFix,
  async (input, ctx): Promise<FactFixResult> => {
    const { recordFactFix } = await import('@causedeck/core/drafting');
    try {
      return await recordFactFix({ db: ctx.tx }, actorOf(ctx), {
        fromVersionId: input.fromVersionId,
        toVersionId: input.toVersionId,
      });
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'draft.write' },
);

export async function recordFactFixAction(raw: unknown): Promise<Result<FactFixResult>> {
  return recordFix(raw);
}
