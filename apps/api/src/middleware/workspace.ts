// Workspace scope (#14, spike §4.1): the workspace comes from the `:workspaceId` path param or the
// `x-workspace-id` header, membership is verified on every request, and handlers run their queries
// through `c.var.withWorkspace(fn)`, which pins the workspace (and user) GUCs for one transaction
// via `withWorkspace` from `@causedeck/db`. Authorization beyond membership goes through `can()`
// (#20) once it lands.
import { memberRole } from '@causedeck/core/workspaces';
import { isUuid, withWorkspace, type Database } from '@causedeck/db';
import type { MiddlewareHandler } from 'hono';

import { ForbiddenError, UnauthenticatedError, ValidationError } from '../errors.ts';
import type { AppEnv } from '../lib/openapi.ts';

export const WORKSPACE_HEADER = 'x-workspace-id';

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
    if (role === null) throw new ForbiddenError('You are not a member of this workspace.');

    c.set('workspaceId', workspaceId);
    c.set('withWorkspace', (fn) =>
      withWorkspace(db, { workspaceId, userId: principal.user.id }, fn),
    );
    await next();
  };
}
