'use server';
// Fact-pattern search server actions (#896, ADR 0051). Each goes through `workspaceAction`: zod input,
// session, membership and `matter.read`; the research service decides again and meters the search.
// `searchAuthoritiesAction` plans the description of the facts; `rerunAuthoritySearchAction` takes the
// plan as edited in the filter chips and never plans again (the service validates it strictly and
// does not count it as a new search). The corpus is global and anonymised, so nothing here reads a
// tenant row besides the caller's usage counter and audit event.
import { z } from 'zod';

import type { Result } from '../../../../../lib/safe-action.ts';
import { ActionError } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

import type { AuthoritySearchResult } from '@causedeck/core/research';

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

const SearchInput = WorkspaceScoped.extend({
  query: z.string().trim().min(1).max(4000),
  answer: z.boolean().optional(),
});

const search = workspaceAction(
  SearchInput,
  async (input, ctx): Promise<AuthoritySearchResult> => {
    const { searchAuthorities } = await import('@causedeck/core/research');
    try {
      return await searchAuthorities(ctx.tx, actorOf(ctx), {
        query: input.query,
        ...(input.answer === true ? { answer: true } : {}),
      });
    } catch (error) {
      throw readable(error);
    }
  },
  { action: 'matter.read' },
);

export async function searchAuthoritiesAction(
  raw: unknown,
): Promise<Result<AuthoritySearchResult>> {
  return search(raw);
}

const RerunInput = WorkspaceScoped.extend({
  /** Validated strictly by the service against the vocabularies. */
  plan: z.unknown(),
  answer: z.boolean().optional(),
});

const rerun = workspaceAction(
  RerunInput,
  async (input, ctx): Promise<AuthoritySearchResult> => {
    const { rerunAuthoritySearch } = await import('@causedeck/core/research');
    try {
      return await rerunAuthoritySearch(ctx.tx, actorOf(ctx), {
        plan: input.plan,
        ...(input.answer === true ? { answer: true } : {}),
      });
    } catch (error) {
      throw readable(error);
    }
  },
  { action: 'matter.read' },
);

export async function rerunAuthoritySearchAction(
  raw: unknown,
): Promise<Result<AuthoritySearchResult>> {
  return rerun(raw);
}
