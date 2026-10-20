'use server';
// Support access server actions (#313). Each goes through `workspaceAction` (zod input,
// `requireSession`, membership) with the owner-only `support.manage` policy action, then calls the
// support domain (`@causedeck/core/support`) on the workspace-scoped transaction `ctx.tx`, which
// checks ownership and the session's state again: only a pending request can be granted or denied,
// so a grant is never extended. `revoke` is both `Revoke now` on the settings page and the shell
// banner's `End session`; staff lose access on their next read (the support context re-checks).
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

/** Grant lengths the page offers, in minutes; the domain allows 1 to 240 (default 60). */
const GRANT_MINUTES = [60, 120, 240] as const;

const SessionTarget = WorkspaceScoped.extend({ sessionId: z.uuid() });
const GrantSession = SessionTarget.extend({
  minutes: z.literal(GRANT_MINUTES).default(60),
});

export interface SupportSessionOutcome {
  sessionId: string;
  status: string;
  expiresAt: string | null;
}

const core = () => import('@causedeck/core/support');

function refresh(): void {
  revalidatePath('/w/[slug]/settings/support', 'page');
  // The shell banner lives in the workspace layout.
  revalidatePath('/w/[slug]', 'layout');
}

function outcome(row: {
  id: string;
  status: string;
  expiresAt: Date | null;
}): SupportSessionOutcome {
  return { sessionId: row.id, status: row.status, expiresAt: row.expiresAt?.toISOString() ?? null };
}

const grant = workspaceAction(
  GrantSession,
  async (input, ctx) => {
    const { grantSession } = await core();
    const row = await grantSession(
      { db: ctx.tx, userId: ctx.userId, workspaceId: ctx.workspaceId },
      { sessionId: input.sessionId, minutes: input.minutes },
    );
    refresh();
    return outcome(row);
  },
  { action: 'support.manage' },
);

const deny = workspaceAction(
  SessionTarget,
  async (input, ctx) => {
    const { denySession } = await core();
    const row = await denySession(
      { db: ctx.tx, userId: ctx.userId, workspaceId: ctx.workspaceId },
      { sessionId: input.sessionId },
    );
    refresh();
    return outcome(row);
  },
  { action: 'support.manage' },
);

const revoke = workspaceAction(
  SessionTarget,
  async (input, ctx) => {
    const { revokeSession } = await core();
    const row = await revokeSession(
      { db: ctx.tx, userId: ctx.userId, workspaceId: ctx.workspaceId },
      { sessionId: input.sessionId },
    );
    refresh();
    return outcome(row);
  },
  { action: 'support.manage' },
);

export async function grantSupportSessionAction(
  raw: unknown,
): Promise<Result<SupportSessionOutcome>> {
  return grant(raw);
}

export async function denySupportSessionAction(
  raw: unknown,
): Promise<Result<SupportSessionOutcome>> {
  return deny(raw);
}

export async function revokeSupportSessionAction(
  raw: unknown,
): Promise<Result<SupportSessionOutcome>> {
  return revoke(raw);
}
