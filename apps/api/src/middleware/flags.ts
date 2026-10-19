// Feature-flag gate for API routes (#22, docs/engineering/flags.md). Runs after `requireWorkspace`
// and asks `@causedeck/flags` whether the flag is on for that workspace. Off is a plain
// `404 NOT_FOUND` problem, the same as a route that does not exist, so a dark feature cannot be
// discovered and the response never names the flag.
import { type EvaluateDeps, isFlagOffError, requireFlag } from '@causedeck/flags/server';
import type { FlagKey } from '@causedeck/flags/keys';
import type { MiddlewareHandler } from 'hono';

import { NotFoundError } from '../errors.ts';
import type { AppEnv } from '../lib/openapi.ts';

/** Route middleware: 404 unless `key` is on for `c.var.workspaceId`. */
export function requireFlagMiddleware(
  key: FlagKey,
  deps?: EvaluateDeps,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = c.get('principal')?.user.id;
    try {
      await requireFlag(key, { workspaceId: c.get('workspaceId'), userId }, deps);
    } catch (error) {
      if (isFlagOffError(error)) throw new NotFoundError();
      throw error;
    }
    await next();
  };
}
