// Route-level authorization (#234, docs/engineering/permissions.md). Runs after `requireWorkspace`
// and asks the central policy (`assertCan` from `@causedeck/auth/policy`) whether the member may
// take `action`. A denial throws the policy's `ForbiddenError`, which the error handler answers
// as `403 FORBIDDEN`, or `404 NOT_FOUND` for a read of a resource the caller may not see.
import {
  assertCan,
  isForbiddenError,
  type Action,
  type AssertOptions,
  type Resource,
} from '@causedeck/auth/policy';
import { recordAccessDenied } from '@causedeck/core/audit';
import type { Database } from '@causedeck/db';
import type { Context, MiddlewareHandler } from 'hono';

import { UnauthenticatedError } from '../errors.ts';
import type { AppEnv } from '../lib/openapi.ts';
import { requestAuditFields } from './workspace.ts';

export interface AuthorizeOptions {
  /** The resource the action targets, from the request; omitted checks the role only. */
  resource?: (c: Context<AppEnv>) => Resource | undefined | Promise<Resource | undefined>;
  /** Denial log line sink; defaults to the console (`assertCan`). */
  logger?: AssertOptions['logger'];
  /** When given, a denial is also recorded as `access.denied` on this db (#228). */
  db?: Database;
}

/** Route middleware: 403 unless the workspace member may take `action`. */
export function authorize(
  action: Action,
  { resource, logger, db }: AuthorizeOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const principal = c.get('principal');
    if (principal === null) throw new UnauthenticatedError();
    const actor = {
      userId: principal.user.id,
      workspaceId: c.get('workspaceId'),
      role: c.get('role'),
    };
    const target = await resource?.(c);
    try {
      assertCan(actor, action, target, logger === undefined ? {} : { logger });
    } catch (error) {
      if (db !== undefined && isForbiddenError(error)) {
        await recordAccessDenied(db, {
          workspaceId: actor.workspaceId,
          member: true,
          actorUserId: actor.userId,
          action,
          reason: error.reason,
          ...requestAuditFields(c),
        });
      }
      throw error;
    }
    await next();
  };
}
