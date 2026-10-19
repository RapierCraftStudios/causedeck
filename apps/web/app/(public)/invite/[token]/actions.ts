'use server';
// Accept a workspace invitation from `/invite/<token>` (#180). Not workspace-scoped (the caller is
// not a member yet), so it uses `safeAction` with `requireSession` directly, like `/onboarding`.
// Typed invitation failures come back as `rejected` with their reason, so the form can show the
// same distinct state the page would; other domain errors map through `toActionError`.
import type { InvitationErrorReason } from '@causedeck/core/workspaces';
import { AcceptInviteInput } from '@causedeck/validators/workspace';

import type { AppSession } from '../../../../lib/auth.ts';
import { safeAction, type Result } from '../../../../lib/safe-action.ts';
import { toActionError } from '../../../../lib/workspace-action.ts';

export type AcceptRejection = InvitationErrorReason | 'ALREADY_MEMBER';

export type AcceptOutcome =
  { status: 'accepted'; slug: string } | { status: 'rejected'; reason: AcceptRejection };

const REASONS: readonly InvitationErrorReason[] = [
  'INVALID',
  'EXPIRED',
  'REVOKED',
  'USED',
  'EMAIL_MISMATCH',
];

/** The `InvitationError` reason, matched by shape so it survives duplicate module copies. */
function rejectionOf(error: unknown): AcceptRejection | null {
  if (!(error instanceof Error) || error.name !== 'WorkspaceError') return null;
  const { reason, code } = error as Error & { reason?: unknown; code?: unknown };
  if (REASONS.includes(reason as InvitationErrorReason)) return reason as InvitationErrorReason;
  // `acceptInvitation` rejects an already-active member with a plain CONFLICT.
  return code === 'CONFLICT' ? 'ALREADY_MEMBER' : null;
}

async function requireSession(): Promise<AppSession> {
  const auth = await import('../../../../lib/auth.ts');
  return auth.requireSession();
}

const accept = safeAction(
  AcceptInviteInput,
  async ({ token }, ctx): Promise<AcceptOutcome> => {
    const session = ctx.session as AppSession;
    const [{ db }, { acceptInvitation }] = await Promise.all([
      import('@causedeck/db'),
      import('@causedeck/core/workspaces'),
    ]);
    try {
      const accepted = await acceptInvitation(db, { userId: session.user.id, token });
      return { status: 'accepted', slug: accepted.workspaceSlug };
    } catch (error) {
      const reason = rejectionOf(error);
      if (reason) return { status: 'rejected', reason };
      throw toActionError(error);
    }
  },
  { getSession: requireSession },
);

export async function acceptInvitationAction(raw: unknown): Promise<Result<AcceptOutcome>> {
  return accept(raw);
}
