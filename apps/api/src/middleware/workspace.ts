// Workspace scope (#14, spike §4.1): the workspace comes from the `:workspaceId` path param or the
// `x-workspace-id` header, membership is verified on every request, and handlers run their queries
// through `c.var.withWorkspace(fn)`, which pins the workspace (and user) GUCs for one transaction
// via `inWorkspaceOn` from `@causedeck/core/runtime` (#299). Authorization beyond membership is
// `authorize(action)` (middleware/authorize.ts, #234), which reads the role set here.
import { isRole } from '@causedeck/auth/policy';
import { recordAccessDenied } from '@causedeck/core/audit';
import { inWorkspaceOn, isUuid } from '@causedeck/core/runtime';
import { memberRole } from '@causedeck/core/workspaces';
import type { Database } from '@causedeck/db';
import type { Context, MiddlewareHandler } from 'hono';

import { ForbiddenError, UnauthenticatedError, ValidationError } from '../errors.ts';
import type { AppEnv } from '../lib/openapi.ts';

export const WORKSPACE_HEADER = 'x-workspace-id';

/** Client IP, user agent and request id for an audit event. */
export function requestAuditFields(c: Context<AppEnv>): {
  ip?: string;
  userAgent?: string;
  requestId?: string;
} {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip')?.trim();
  const userAgent = c.req.header('user-agent');
  const requestId = c.get('requestId');
  return {
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

/** Route middleware for workspace-scoped routes; runs after `requireAuth`. */
export function requireWorkspace(db: Database): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const principal = c.get('principal');
    if (principal === null) throw new UnauthenticatedError();

    const fromPath = c.req.param('workspaceId');
    const workspaceId = fromPath ?? c.req.header(WORKSPACE_HEADER);
    const source = fromPath === undefined ? `header.${WORKSPACE_HEADER}` : 'param.workspaceId';
    if (workspaceId === undefined) {
      throw new ValidationError([{ path: source, message: 'A workspace id is required' }]);
    }
    if (!isUuid(workspaceId)) {
      throw new ValidationError([{ path: source, message: 'Must be a workspace id (uuid)' }]);
    }
    // Same answer for "does not exist" and "not a member", so ids cannot be probed.
    const role = await memberRole(db, principal.user.id, workspaceId);
    if (role === null || !isRole(role)) {
      // Account-level `access.denied` (#228); it never changes the response below.
      await recordAccessDenied(db, {
        workspaceId,
        member: false,
        actorUserId: principal.user.id,
        ...requestAuditFields(c),
      });
      throw new ForbiddenError('You are not a member of this workspace.');
    }

    c.set('workspaceId', workspaceId);
    c.set('role', role);
    c.set('withWorkspace', (fn) =>
      inWorkspaceOn(db, { workspaceId, userId: principal.user.id }, fn),
    );
    await next();
  };
}
