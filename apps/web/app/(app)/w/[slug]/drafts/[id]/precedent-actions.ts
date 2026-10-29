'use server';
// Drafting studio precedent actions (#904, M5). Both go through `workspaceAction` (strict zod input,
// session, membership, the policy action asserted here and again by the core service).
// - `searchPrecedentsForBlockAction`: the member's own and chamber-shared passages nearest the
//   block's prompt (`searchPrecedents`, scope enforced in SQL), ranked by court, kind, language and
//   similarity (`rankPrecedents`) with the reason for each. A clerk is FORBIDDEN.
// - `proposePrecedentAction`: files the selected text as an L2 proposal. Nothing is saved as a
//   precedent here; the lawyer confirms on the memory pages. The version must have been exported.
// Passage text is returned to the caller and never logged.
import { assertCan } from '@causedeck/auth/policy';
import { PrecedentKind } from '@causedeck/validators';
import { z } from 'zod';

import type { PrecedentPassage } from '../../../../../../components/drafting/precedent-picker.tsx';
import { memoryDeps } from '../../../../../../lib/memory/deps.ts';
import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

export interface PrecedentSearchResult {
  passages: PrecedentPassage[];
}

export type PrecedentProposalOutcome =
  { status: 'proposed'; proposalId: string } | { status: 'skipped' };

const Search = WorkspaceScoped.extend({
  query: z.string().trim().min(1).max(4000),
  courtId: z.uuid().nullable(),
  kind: PrecedentKind.nullable(),
  language: z.string().trim().min(2).max(16),
}).strict();

const Propose = WorkspaceScoped.extend({
  passageText: z.string().trim().min(1).max(20_000),
  kind: PrecedentKind,
  courtId: z.uuid().nullable(),
  language: z.string().trim().min(2).max(16),
  draftVersionId: z.uuid(),
  anchorId: z.string().min(1).max(200),
}).strict();

const MAX_PASSAGES = 10;

/** Core domain errors become the client-safe codes; anything else stays an INTERNAL failure. */
function rethrow(error: unknown): never {
  const code = domainErrorCode(error);
  if (code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'VALIDATION') {
    throw new ActionError(code, '');
  }
  throw error;
}

const search = workspaceAction(
  Search,
  async (input, ctx): Promise<PrecedentSearchResult> => {
    assertCan(ctx.actor, 'memory.read');
    const { searchPrecedents } = await import('@causedeck/core/memory');
    const { rankPrecedents } = await import('@causedeck/drafting');
    try {
      const found = await searchPrecedents(
        memoryDeps(ctx.tx),
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        input.query,
        { limit: MAX_PASSAGES },
      );
      const ranked = rankPrecedents(
        found.map((p) => ({
          passageId: p.passageId,
          courtId: p.courtId,
          kind: p.kind,
          language: p.language,
          ...(p.distance === undefined ? {} : { distance: p.distance }),
        })),
        { courtId: input.courtId, kind: input.kind, language: input.language },
      );
      const byId = new Map(found.map((p) => [p.passageId, p]));
      return {
        passages: ranked.flatMap((entry) => {
          const p = byId.get(entry.passageId);
          return p === undefined
            ? []
            : [
                {
                  passageId: p.passageId,
                  text: p.text,
                  kind: p.kind,
                  courtId: p.courtId,
                  language: p.language,
                  sourceDraftVersionId: p.sourceDraftVersionId,
                  anchorId: p.anchorId,
                  score: entry.score,
                  reasons: entry.reasons,
                },
              ];
        }),
      };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'memory.read' },
);

export async function searchPrecedentsForBlockAction(
  raw: unknown,
): Promise<Result<PrecedentSearchResult>> {
  return search(raw);
}

const propose = workspaceAction(
  Propose,
  async (input, ctx): Promise<PrecedentProposalOutcome> => {
    assertCan(ctx.actor, 'memory.write');
    const { proposePrecedent } = await import('@causedeck/core/memory');
    try {
      const proposal = await proposePrecedent(
        memoryDeps(ctx.tx),
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        {
          passageText: input.passageText,
          kind: input.kind,
          courtId: input.courtId,
          language: input.language,
          sourceAnchor: { draftVersionId: input.draftVersionId, anchorId: input.anchorId },
          // The lawyer chose this text themselves.
          confidence: 1,
        },
      );
      return proposal === null
        ? { status: 'skipped' }
        : { status: 'proposed', proposalId: proposal.id };
    } catch (error) {
      return rethrow(error);
    }
  },
  { action: 'memory.write' },
);

export async function proposePrecedentAction(
  raw: unknown,
): Promise<Result<PrecedentProposalOutcome>> {
  return propose(raw);
}
