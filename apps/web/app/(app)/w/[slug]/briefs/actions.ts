'use server';
// Owner-facing brief sharing (#507). Both actions go through `workspaceAction`: strict zod input,
// session, membership of the named workspace and, for creating, the owner-only `export.run` policy
// action (a share sends workspace data out of it). The core service (`@causedeck/core/shares`)
// decides again: it rate limits per user, refuses a sensitive matter, stores only the sha-256 of the
// token and writes the audit and funnel rows. The token is returned once, here, and never stored.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ActionError, type Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The `CONFLICT` message that means the sharing rate limit was hit (the panel shows its own text). */
const RATE_LIMITED_MESSAGE = 'RATE_LIMITED';

const Create = WorkspaceScoped.extend({
  listingId: z.uuid(),
  /** Days until the link expires (default 7, at most 30). */
  expiresInDays: z.number().int().min(1).max(30).default(7),
}).strict();
const Revoke = WorkspaceScoped.extend({ shareId: z.uuid() }).strict();

export interface CreatedShareView {
  id: string;
  /** Relative link, `/share/<token>`; the client makes it absolute. Shown once. */
  path: string;
  expiresAt: string;
}

const create = workspaceAction(
  Create,
  async ({ listingId, expiresInDays }, ctx): Promise<CreatedShareView> => {
    const { db } = await import('@causedeck/core/runtime');
    const { createBriefShare } = await import('@causedeck/core/shares');
    // The app db, not `ctx.tx`: the service opens its own workspace transaction, and its rate-limit
    // count must survive a refusal that rolls the action's transaction back.
    let share;
    try {
      share = await createBriefShare(
        { db },
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        listingId,
        { ttlMs: expiresInDays * DAY_MS },
      );
    } catch (error) {
      // The per-user rate limit has no action code of its own: a CONFLICT whose message is the key.
      if ((error as { code?: unknown } | null)?.code === 'RATE_LIMITED') {
        throw new ActionError('CONFLICT', RATE_LIMITED_MESSAGE);
      }
      throw error;
    }
    revalidatePath('/w/[slug]/matters/[id]', 'page');
    return {
      id: share.id,
      path: `/share/${encodeURIComponent(share.token)}`,
      expiresAt: share.expiresAt.toISOString(),
    };
  },
  { action: 'export.run' },
);

const revoke = workspaceAction(Revoke, async ({ shareId }, ctx): Promise<{ id: string }> => {
  const { db } = await import('@causedeck/core/runtime');
  const { revokeBriefShare } = await import('@causedeck/core/shares');
  // Membership is enough here: the service lets only the link's creator or an owner revoke it.
  await revokeBriefShare({ db }, { workspaceId: ctx.workspaceId, userId: ctx.userId }, shareId);
  revalidatePath('/w/[slug]/matters/[id]', 'page');
  return { id: shareId };
});

export async function createBriefShareAction(raw: unknown): Promise<Result<CreatedShareView>> {
  return create(raw);
}

export async function revokeBriefShareAction(raw: unknown): Promise<Result<{ id: string }>> {
  return revoke(raw);
}
