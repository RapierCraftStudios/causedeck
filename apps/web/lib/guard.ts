// The server authorization guard (#234, spike §4.1): session, then workspace membership, then the
// central policy (`assertCan` from `@causedeck/auth/policy`). Server actions reach it through
// `workspaceAction` (lib/workspace-action.ts); route handlers call `guard` directly and turn
// failures into responses with `guardResponse`. The UI's `<Can>`/`useCan` only mirror this.
// Destructive actions (delete, export, billing) also need the owner 2FA policy
// (lib/require-2fa-for-owners.ts, #290): an owner past the 7-day grace without 2FA is refused.
import {
  assertCan,
  conceals,
  isForbiddenError,
  isRole,
  type Action,
  type Actor,
  type Resource,
  type Role,
} from '@causedeck/auth/policy';

import type { AppSession } from './auth.ts';
import {
  assertOwnerTwoFactor,
  isDestructive,
  TWO_FACTOR_REQUIRED,
  type OwnerGraceLookup,
} from './require-2fa-for-owners.ts';
import { ActionError } from './safe-action.ts';

export interface GuardRequest {
  workspaceId: string;
  /** The action to authorize; omitted means membership only. */
  action?: Action | undefined;
  resource?: Resource | undefined;
  /** An already-resolved session (e.g. `safeAction`'s); otherwise `requireSession` runs. */
  session?: AppSession | undefined;
  /**
   * Apply the owner 2FA policy even though `action` is not one of `DESTRUCTIVE_ACTIONS` (or is
   * omitted), e.g. data downloads whose permission core checks. Destructive actions always apply it.
   */
  destructive?: boolean | undefined;
}

/** An access denial to audit (`access.denied`, #228). */
export interface AccessDenial {
  workspaceId: string;
  /** Members' denials go to the workspace chain; non-members' are account-level. */
  member: boolean;
  actorUserId: string;
  action?: string | undefined;
  reason?: string | undefined;
}

export interface GuardDeps {
  /** Defaults to `lib/auth.ts` `requireSession`. */
  requireSession?: () => Promise<AppSession>;
  /** Defaults to `@causedeck/core/runtime` `memberRoleFor` (the app db). */
  memberRole?: (userId: string, workspaceId: string) => Promise<string | null>;
  /** Defaults to `@causedeck/core/runtime` `recordAccessDeniedFor` (the app db). */
  recordDenied?: (denial: AccessDenial) => Promise<void>;
  /** Defaults to `@causedeck/core/runtime` `ownerGraceFor` (the owner 2FA grace, #290). */
  ownerGrace?: OwnerGraceLookup;
}

export interface Guarded {
  session: AppSession;
  userId: string;
  workspaceId: string;
  role: Role;
  actor: Actor;
}

async function defaultRequireSession(): Promise<AppSession> {
  const { requireSession } = await import('./auth.ts');
  return requireSession();
}

async function defaultMemberRole(userId: string, workspaceId: string): Promise<string | null> {
  const { memberRoleFor } = await import('@causedeck/core/runtime');
  return memberRoleFor(userId, workspaceId);
}

/** Writes in its own transaction and never throws, so the original denial still surfaces. */
export async function defaultRecordDenied(denial: AccessDenial): Promise<void> {
  try {
    const { recordAccessDeniedFor } = await import('@causedeck/core/runtime');
    await recordAccessDeniedFor(denial);
  } catch {
    // recordAccessDenied logs its own write failures; a failed import must not mask the denial.
  }
}

/**
 * Authenticate, check membership and authorize. Throws `UnauthenticatedError` when signed out,
 * `ActionError('FORBIDDEN')` for non-members (suspended, removed, soft-deleted workspace), and the
 * policy's `ForbiddenError` when `action` is denied, and `ActionError('FORBIDDEN')` when a
 * destructive action meets an owner without 2FA after the grace.
 */
export async function guard(
  { workspaceId, action, resource, session: given, destructive = false }: GuardRequest,
  {
    requireSession = defaultRequireSession,
    memberRole = defaultMemberRole,
    recordDenied = defaultRecordDenied,
    ownerGrace,
  }: GuardDeps = {},
): Promise<Guarded> {
  const session = given ?? (await requireSession());
  const userId = session.user.id;
  const role = await memberRole(userId, workspaceId);
  // A role the policy does not know is treated like no membership (deny by default).
  if (role === null || !isRole(role)) {
    await recordDenied({ workspaceId, member: false, actorUserId: userId, action });
    throw new ActionError('FORBIDDEN', '');
  }
  const actor: Actor = { userId, workspaceId, role };
  if (action !== undefined) {
    try {
      assertCan(actor, action, resource);
    } catch (error) {
      if (isForbiddenError(error)) {
        await recordDenied({
          workspaceId,
          member: true,
          actorUserId: userId,
          action,
          reason: error.reason,
        });
      }
      throw error;
    }
  }
  if (destructive || isDestructive(action)) {
    try {
      await assertOwnerTwoFactor(session, workspaceId, { role, ...(ownerGrace && { ownerGrace }) });
    } catch (error) {
      if (error instanceof ActionError && error.code === 'FORBIDDEN') {
        await recordDenied({
          workspaceId,
          member: true,
          actorUserId: userId,
          action,
          reason: TWO_FACTOR_REQUIRED,
        });
      }
      throw error;
    }
  }
  return { session, userId, workspaceId, role, actor };
}

const problem = (status: number, error: string) => Response.json({ error }, { status });

/**
 * A route handler's response for a `guard` failure: 401 signed out, 403 forbidden, 404 for a
 * concealed read (so ids cannot be probed); `null` for anything else (rethrow it).
 */
export function guardResponse(error: unknown): Response | null {
  if (error instanceof Error && 'code' in error && error.code === 'UNAUTHENTICATED') {
    return problem(401, 'unauthorized');
  }
  if (isForbiddenError(error)) {
    return conceals(error) ? problem(404, 'not_found') : problem(403, 'forbidden');
  }
  if (error instanceof ActionError && error.code === 'FORBIDDEN') return problem(403, 'forbidden');
  return null;
}
