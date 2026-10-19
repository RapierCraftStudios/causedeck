// Workspace-scoped server actions (#179, spike §3). Every action that touches one workspace goes
// through `workspaceAction`: zod-validate the input (via `safeAction`), authenticate with
// `requireSession`, load the caller's membership and reject non-members with `FORBIDDEN` before
// the handler runs. Suspended or removed members and soft-deleted workspaces count as non-members.
//
// The `withWorkspace` seam (#19): the handler's DB work runs inside `withWorkspace` from
// `@causedeck/db`, which pins `app.workspace_id` / `app.user_id` for one transaction, and gets that
// transaction as `ctx.tx`. Today the settings are informational; once #19 lands its RLS policies
// read them, so handlers must use `ctx.tx` (never the global `db`) for workspace data and need no
// change when RLS is switched on.
import type { WorkspaceRole } from '@causedeck/core/workspaces';
import type { Transaction } from '@causedeck/db';
import { z, type ZodType } from 'zod';

import type { AppSession } from './auth.ts';
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
  /** The workspace-scoped transaction (`withWorkspace`); use it for every workspace query. */
  tx: Transaction;
}

export interface WorkspaceActionOptions {
  /** Defaults to `lib/auth.ts` `requireSession`. */
  requireSession?: () => Promise<AppSession>;
  /** Defaults to `@causedeck/core/workspaces` `memberRole` on the app `db`. */
  memberRole?: (userId: string, workspaceId: string) => Promise<WorkspaceRole | null>;
  /** Defaults to `@causedeck/db` `withWorkspace` on the app `db`. */
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
  const [{ db }, { memberRole }] = await Promise.all([
    import('@causedeck/db'),
    import('@causedeck/core/workspaces'),
  ]);
  return memberRole(db, userId, workspaceId);
}

async function defaultRunInWorkspace<T>(
  scope: { workspaceId: string; userId: string },
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const { db, withWorkspace } = await import('@causedeck/db');
  return withWorkspace(db, scope, fn);
}

/** A server action on one workspace: validated, authenticated and membership-checked. */
export function workspaceAction<I extends { workspaceId: string }, O>(
  schema: ZodType<I>,
  handler: (input: I, ctx: WorkspaceActionCtx) => Promise<O>,
  {
    requireSession = defaultRequireSession,
    memberRole = defaultMemberRole,
    runInWorkspace = defaultRunInWorkspace,
  }: WorkspaceActionOptions = {},
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
      const role = await memberRole(userId, workspaceId);
      if (role === null) throw new ActionError('FORBIDDEN', '');
      try {
        return await runInWorkspace({ workspaceId, userId }, (tx) =>
          handler(input, { ...ctx, session, userId, workspaceId, role, tx }),
        );
      } catch (error) {
        throw toActionError(error);
      }
    },
    { getSession: requireSession },
  );
}
