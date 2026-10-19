'use server';
// Accept a workspace invitation from `/invite/<token>` (#180). Not workspace-scoped (the caller is
// not a member yet), so it uses `safeAction` with `requireSession` directly, like `/onboarding`.
// Typed invitation failures come back as `rejected` with their reason, so the form can show the
// same distinct state the page would; other domain errors map through `toActionError`. The billing
// seat gate (#203) is installed first, so a workspace with no seat left rejects with `SEAT_LIMIT`.
import type { InvitationErrorReason } from '@causedeck/core/workspaces';
import { AcceptInviteInput } from '@causedeck/validators/workspace';

import type { AppSession } from '../../../../lib/auth.ts';
import { safeAction, type Result } from '../../../../lib/safe-action.ts';
import { toActionError } from '../../../../lib/workspace-action.ts';

export type AcceptRejection = InvitationErrorReason | 'ALREADY_MEMBER' | 'SEAT_LIMIT';

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
  if (error instanceof Error && error.name === 'EntitlementError') {
    return (error as Error & { code?: unknown }).code === 'ENTITLEMENT_EXCEEDED'
      ? 'SEAT_LIMIT'
      : null;
  }
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
    const [{ acceptInvitationFor }, { installBillingEntitlements }] = await Promise.all([
      import('@causedeck/core/runtime'),
      import('@causedeck/core/billing'),
    ]);
    installBillingEntitlements();
    try {
      const accepted = await acceptInvitationFor({ userId: session.user.id, token });
      return { status: 'accepted', slug: accepted.workspaceSlug };
    } catch (error) {
      const reason = rejectionOf(error);
      if (reason) return { status: 'rejected', reason };
      throw toActionError(error);
    }
  },
  { getSession: requireSession },
);

// authz: public — the caller is not a member yet; `acceptInvitation` verifies the token and that
// it was sent to the signed-in user's email.
export async function acceptInvitationAction(raw: unknown): Promise<Result<AcceptOutcome>> {
  return accept(raw);
}
