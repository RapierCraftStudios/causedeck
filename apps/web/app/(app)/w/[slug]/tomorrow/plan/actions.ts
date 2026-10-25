'use server';
// Tomorrow-plan server actions (#63). Each goes through `workspaceAction`: strict zod input, session,
// membership and `appearance.assign` asserted by `guard`; the delegation service decides again with
// `can()` on the workspace-scoped transaction `ctx.tx`. Accepting a suggestion is the owner's decision
// (L2): suggestions are never written by `suggestAssignments`, only by these actions, one by one.
import { AssignInput, DayInput } from '@causedeck/validators';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

const Assign = WorkspaceScoped.extend(AssignInput.shape).strict();
const Accept = WorkspaceScoped.extend({ suggestion: AssignInput }).strict();
const AcceptAll = WorkspaceScoped.extend({
  suggestions: z.array(AssignInput).min(1).max(200),
}).strict();

const Outcomes = WorkspaceScoped.extend(DayInput.shape).strict();

export interface AssignedView {
  appearanceId: string;
  listingId: string;
  memberId: string;
  previousMemberId: string | null;
}

const assign = workspaceAction(
  Assign,
  async ({ listingId, memberId, capacity, note, grantAccess }, ctx) => {
    const { assignAppearance } = await import('@causedeck/core/delegation');
    const row = await assignAppearance(
      { db: ctx.tx },
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      {
        listingId,
        memberId,
        capacity,
        ...(note === undefined ? {} : { note }),
        ...(grantAccess === undefined ? {} : { grantAccess }),
      },
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

export interface OutcomesLiveView {
  members: {
    memberId: string;
    name: string;
    total: number;
    outcomesIn: number;
  }[];
  lastConfirmedAt: string | null;
}

const outcomesLive = workspaceAction(
  Outcomes,
  async ({ date }, ctx): Promise<OutcomesLiveView> => {
    const { chamberOutcomesLive } = await import('@causedeck/core/delegation');
    const live = await chamberOutcomesLive(
      { db: ctx.tx },
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      { date },
    );
    return {
      members: live.members.map(({ memberId, name, total, outcomesIn }) => ({
        memberId,
        name,
        total,
        outcomesIn,
      })),
      lastConfirmedAt: live.lastConfirmedAt?.toISOString() ?? null,
    };
  },
  { action: 'court_day.view_all' },
);

/** The owner's live outcome strip: polled while the tab is visible (#62 confirmations). */
export async function outcomesLiveAction(raw: unknown): Promise<Result<OutcomesLiveView>> {
  return outcomesLive(raw);
}
