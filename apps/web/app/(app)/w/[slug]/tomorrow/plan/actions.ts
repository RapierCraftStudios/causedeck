'use server';
// Tomorrow-plan server actions (#63). Each goes through `workspaceAction`: strict zod input, session,
// membership and `appearance.assign` asserted by `guard`; the delegation service decides again with
// `can()` on the workspace-scoped transaction `ctx.tx`. Accepting a suggestion is the owner's decision
// (L2): suggestions are never written by `suggestAssignments`, only by these actions, one by one.
import { AssignInput } from '@causedeck/validators';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

const Assign = WorkspaceScoped.extend(AssignInput.shape).strict();
const Accept = WorkspaceScoped.extend({ suggestion: AssignInput }).strict();
const AcceptAll = WorkspaceScoped.extend({
  suggestions: z.array(AssignInput).min(1).max(200),
}).strict();

export interface AssignedView {
  appearanceId: string;
  listingId: string;
  memberId: string;
  previousMemberId: string | null;
}

const assign = workspaceAction(
  Assign,
  async ({ workspaceId: _workspaceId, ...input }, ctx) => {
    const { assignAppearance } = await import('@causedeck/core/delegation');
    const row = await assignAppearance(
      { db: ctx.tx },
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      input,
    );
    revalidatePath('/w/[slug]/tomorrow/plan', 'page');
    return {
      appearanceId: row.appearanceId,
      listingId: row.listingId,
      memberId: row.memberId,
      previousMemberId: row.previousMemberId,
    };
  },
  { action: 'appearance.assign' },
);

const acceptOne = workspaceAction(
  Accept,
  async ({ suggestion }, ctx) => {
    const { assignAppearance } = await import('@causedeck/core/delegation');
    const row = await assignAppearance(
      { db: ctx.tx },
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      suggestion,
    );
    revalidatePath('/w/[slug]/tomorrow/plan', 'page');
    return {
      appearanceId: row.appearanceId,
      listingId: row.listingId,
      memberId: row.memberId,
      previousMemberId: row.previousMemberId,
    };
  },
  { action: 'appearance.assign' },
);

const acceptAll = workspaceAction(
  AcceptAll,
  async ({ suggestions }, ctx) => {
    const { assignAppearance } = await import('@causedeck/core/delegation');
    const done: AssignedView[] = [];
    for (const suggestion of suggestions) {
      const row = await assignAppearance(
        { db: ctx.tx },
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        suggestion,
      );
      done.push({
        appearanceId: row.appearanceId,
        listingId: row.listingId,
        memberId: row.memberId,
        previousMemberId: row.previousMemberId,
      });
    }
    revalidatePath('/w/[slug]/tomorrow/plan', 'page');
    return { accepted: done };
  },
  { action: 'appearance.assign' },
);

export async function assignAppearanceAction(raw: unknown): Promise<Result<AssignedView>> {
  return assign(raw);
}

export async function acceptSuggestionAction(raw: unknown): Promise<Result<AssignedView>> {
  return acceptOne(raw);
}

export async function acceptAllSuggestionsAction(
  raw: unknown,
): Promise<Result<{ accepted: AssignedView[] }>> {
  return acceptAll(raw);
}
