'use server';
// Brief sheet server actions (#61, PRD PR-1). Each goes through `workspaceAction` (zod input,
// session, membership, `matter.write`) and the core brief services on the workspace transaction.
// The acting user is always the session's. The services decide again per listing.
// - `markPreparedAction` marks or unmarks the brief prepared (who and when are stored).
// - `setCarryItemAction` ticks, adds, removes or reviews a carry item (persisted in `brief_state`).
// - `setBriefNoteAction` stores the brief note; the synopsis edit-in-place goes here as a matter
//   note until the memory proposal path (#72) lands (the edit is never written to memory).
// - `setPrintNotesAction` remembers, per member, that private court notes may print.
import { MarkPreparedInput, SetBriefNoteInput, SetCarryItemInput } from '@causedeck/validators';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

const NO_EVENTS = {
  emit() {
    // `brief.stale` has no subscriber yet; the sheet re-reads on revalidation.
  },
};

const ONE_YEAR = 60 * 60 * 24 * 365;

export interface BriefStateResult {
  listing_id: string;
  prepared_by: string | null;
  prepared_at: string | null;
  note: string | null;
  carry: {
    key: string;
    manual: boolean;
    label: string | null;
    ticked: boolean;
    removed: boolean;
  }[];
}

function revalidateBrief(): void {
  revalidatePath('/w/[slug]/briefs/[listing-id]', 'page');
}

/** A domain refusal keeps its code; anything else is rethrown for the generic mapping. */
function toActionError(error: unknown): never {
  const code = domainErrorCode(error);
  if (
    error instanceof Error &&
    (code === 'VALIDATION' || code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'CONFLICT')
  ) {
    throw new ActionError(code, error.message);
  }
  throw error;
}

const prepared = workspaceAction(
  WorkspaceScoped.extend({ ...MarkPreparedInput.shape, prepared: z.boolean().default(true) }),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the scope comes from ctx
  async ({ workspaceId: _workspaceId, prepared: mark, ...input }, ctx) => {
    const { markPrepared, unmarkPrepared } = await import('@causedeck/core/briefs');
    try {
      const run = mark ? markPrepared : unmarkPrepared;
      const state = await run(
        { db: ctx.tx, events: NO_EVENTS },
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        input,
      );
      revalidateBrief();
      return state;
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'matter.write' },
);

export async function markPreparedAction(raw: unknown): Promise<Result<BriefStateResult>> {
  return prepared(raw);
}

const carry = workspaceAction(
  z.intersection(WorkspaceScoped, SetCarryItemInput),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the scope comes from ctx
  async ({ workspaceId: _workspaceId, ...input }, ctx) => {
    const { setCarryItem } = await import('@causedeck/core/briefs');
    try {
      const state = await setCarryItem(
        { db: ctx.tx, events: NO_EVENTS },
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        input,
      );
      revalidateBrief();
      return state;
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'matter.write' },
);

export async function setCarryItemAction(raw: unknown): Promise<Result<BriefStateResult>> {
  return carry(raw);
}

const note = workspaceAction(
  WorkspaceScoped.extend(SetBriefNoteInput.shape),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the scope comes from ctx
  async ({ workspaceId: _workspaceId, ...input }, ctx) => {
    const { setBriefNote } = await import('@causedeck/core/briefs');
    try {
      const state = await setBriefNote(
        { db: ctx.tx, events: NO_EVENTS },
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        input,
      );
      revalidateBrief();
      return state;
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'matter.write' },
);

export async function setBriefNoteAction(raw: unknown): Promise<Result<BriefStateResult>> {
  return note(raw);
}

const printNotes = workspaceAction(
  WorkspaceScoped.extend({ include: z.boolean() }),
  async ({ include }, ctx) => {
    const jar = await cookies();
    jar.set(`brief-print-notes-${ctx.userId}`, include ? '1' : '0', {
      path: '/',
      maxAge: ONE_YEAR,
      sameSite: 'lax',
    });
    return { include };
  },
);

export async function setPrintNotesAction(raw: unknown): Promise<Result<{ include: boolean }>> {
  return printNotes(raw);
}
