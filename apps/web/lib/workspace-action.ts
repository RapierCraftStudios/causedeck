// Workspace-scoped server actions (#179, spike §3). Every action that touches one workspace goes
// through `workspaceAction`: zod-validate the input (via `safeAction`), authenticate with
// `requireSession`, load the caller's membership and reject non-members with `FORBIDDEN` before
// the handler runs. Suspended or removed members and soft-deleted workspaces count as non-members.
// With an `action` option, `guard` (lib/guard.ts) also authorizes it with the central policy
// (#234); a denial is the policy's `ForbiddenError`, which `safeAction` returns as `FORBIDDEN`.
// Destructive actions (delete, export, billing) are also refused to an owner without 2FA after
// the 7-day grace (lib/require-2fa-for-owners.ts, #290), again as `FORBIDDEN`.
//
// The `withWorkspace` seam (#19): the handler's DB work runs inside `inWorkspace` from
// `@causedeck/core/runtime` (`withWorkspace` on the app db, #298), which pins `app.workspace_id` / `app.user_id` for one transaction, and gets that
// transaction as `ctx.tx`. Today the settings are informational; once #19 lands its RLS policies
// read them, so handlers must use `ctx.tx` (never the global `db`) for workspace data and need no
// change when RLS is switched on.
import type { Action, Actor, Resource } from '@causedeck/auth/policy';
import type { WorkspaceRole } from '@causedeck/core/workspaces';
import type { Transaction } from '@causedeck/core/runtime';
import { z, type ZodType } from 'zod';

import type { AppSession } from './auth.ts';
import { defaultRecordDenied, guard, type AccessDenial } from './guard.ts';
import type { OwnerGraceLookup } from './require-2fa-for-owners.ts';
import {
  ActionError,
  safeAction,
  type ActionCtx,
  type ActionErrorCode,
  type Result,
} from './safe-action.ts';

/** Inputs to a workspace action always name the workspace they act on. */
export const WorkspaceScoped = z.object({ workspaceId: z.uuid() });

export interface WorkspaceActionCtx extends ActionCtx {
  session: AppSession;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  /** The policy actor (`can()` / `assertCan`) for further, resource-level checks. */
  actor: Actor;
  /** The workspace-scoped transaction (`withWorkspace`); use it for every workspace query. */
  tx: Transaction;
}

export interface WorkspaceActionOptions<I = unknown> {
  /** The policy action the caller must be allowed; omitted means membership only. */
  action?: Action;
  /** The resource `action` is checked against, from the validated input. */
  resource?: (input: I) => Resource | undefined;
  /** Defaults to `lib/auth.ts` `requireSession`. */
  requireSession?: () => Promise<AppSession>;
  /** Defaults to `@causedeck/core/runtime` `memberRoleFor` (the app db). */
  memberRole?: (userId: string, workspaceId: string) => Promise<WorkspaceRole | null>;
  /** Defaults to `@causedeck/core/runtime` `recordAccessDeniedFor` on the app db (#228). */
  recordDenied?: (denial: AccessDenial) => Promise<void>;
  /** Defaults to `@causedeck/core/runtime` `ownerGraceFor` (the owner 2FA grace in `guard`, #290). */
  ownerGrace?: OwnerGraceLookup;
  /** Defaults to `@causedeck/core/runtime` `inWorkspace` (`withWorkspace` on the app db). */
  runInWorkspace?: <T>(
    scope: { workspaceId: string; userId: string },
    fn: (tx: Transaction) => Promise<T>,
  ) => Promise<T>;
}

/** Workspace domain error codes (`@causedeck/core/workspaces` `WorkspaceError`) as action codes. */
const WORKSPACE_CODES: readonly ActionErrorCode[] = [
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'VALIDATION',
];

/**
 * `WorkspaceError` from the domain service as the matching `ActionError`, so its client-safe
 * message reaches the form. Anything else is returned unchanged (and `safeAction` hides it).
 */
export function toActionError(error: unknown): unknown {
  if (
    error instanceof Error &&
    error.name === 'WorkspaceError' &&
    'code' in error &&
    WORKSPACE_CODES.includes(error.code as ActionErrorCode)
  ) {
    return new ActionError(error.code as ActionErrorCode, error.message);
  }
  return error;
}

async function defaultRequireSession(): Promise<AppSession> {
  const { requireSession } = await import('./auth.ts');
  return requireSession();
}

async function defaultMemberRole(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const { memberRoleFor } = await import('@causedeck/core/runtime');
  return memberRoleFor(userId, workspaceId);
}

async function defaultRunInWorkspace<T>(
  scope: { workspaceId: string; userId: string },
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const { inWorkspace } = await import('@causedeck/core/runtime');
  return inWorkspace(scope, fn);
}

/** A server action on one workspace: validated, authenticated and membership-checked. */
export function workspaceAction<I extends { workspaceId: string }, O>(
  schema: ZodType<I>,
  handler: (input: I, ctx: WorkspaceActionCtx) => Promise<O>,
  {
    action,
    resource,
    requireSession = defaultRequireSession,
    memberRole = defaultMemberRole,
    recordDenied = defaultRecordDenied,
    ownerGrace,
    runInWorkspace = defaultRunInWorkspace,
  }: WorkspaceActionOptions<I> = {},
): (raw: unknown) => Promise<Result<O>> {
  return safeAction(
    schema,
    async (input, ctx) => {
      // `requireSession` ran as `getSession` below: a missing session is already UNAUTHENTICATED.
      const session = ctx.session as AppSession;
      const userId = session.user.id;
      const scope = WorkspaceScoped.safeParse(input);
      if (!scope.success) throw new ActionError('FORBIDDEN', '');
      const { workspaceId } = scope.data;
      const { role, actor } = await guard(
        { workspaceId, action, resource: resource?.(input), session },
        { memberRole, recordDenied, ...(ownerGrace && { ownerGrace }) },
      );
      try {
        return await runInWorkspace({ workspaceId, userId }, (tx) =>
          handler(input, { ...ctx, session, userId, workspaceId, role, actor, tx }),
        );
      } catch (error) {
        const mapped = toActionError(error);
        // A domain denial: the workspace transaction rolled back, so it is recorded on its own.
        if (mapped instanceof ActionError && mapped.code === 'FORBIDDEN') {
          await recordDenied({
            workspaceId,
            member: true,
            actorUserId: userId,
            action,
            reason: 'FORBIDDEN',
          });
        }
        throw mapped;
      }
    },
    { getSession: requireSession },
  );
}
