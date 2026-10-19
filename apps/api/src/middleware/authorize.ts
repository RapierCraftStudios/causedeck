// Route-level authorization (#234, docs/engineering/permissions.md). Runs after `requireWorkspace`
// and asks the central policy (`assertCan` from `@causedeck/auth/policy`) whether the member may
// take `action`. A denial throws the policy's `ForbiddenError`, which the error handler answers
// as `403 FORBIDDEN`, or `404 NOT_FOUND` for a read of a resource the caller may not see.
import { assertCan, type Action, type AssertOptions, type Resource } from '@causedeck/auth/policy';
import type { Context, MiddlewareHandler } from 'hono';

import { UnauthenticatedError } from '../errors.ts';
import type { AppEnv } from '../lib/openapi.ts';

export interface AuthorizeOptions {
  /** The resource the action targets, from the request; omitted checks the role only. */
  resource?: (c: Context<AppEnv>) => Resource | undefined | Promise<Resource | undefined>;
  /** Denial log line sink; defaults to the console (`assertCan`). */
  logger?: AssertOptions['logger'];
}

/** Route middleware: 403 unless the workspace member may take `action`. */
export function authorize(
  action: Action,
  { resource, logger }: AuthorizeOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const principal = c.get('principal');
    if (principal === null) throw new UnauthenticatedError();
    const actor = {
      userId: principal.user.id,
      workspaceId: c.get('workspaceId'),
      role: c.get('role'),
    };
    assertCan(actor, action, await resource?.(c), logger === undefined ? {} : { logger });
    await next();
  };
}
