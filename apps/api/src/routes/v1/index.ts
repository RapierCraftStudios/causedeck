// The `/v1` router (#14). Additive changes only; breaking changes go to `/v2`. Middleware order:
// resolve the caller → CSRF (cookie callers) → rate limit (per user, per IP when anonymous) →
// idempotency (POST) → routes (each adds `requireAuth` unless `public: true`).
import type { Database } from '@causedeck/db';
import type { MiddlewareHandler } from 'hono';

import { createRouter, type AppEnv, type AppRouter } from '../../lib/openapi.ts';

import { meRouter } from './me.ts';
import { workspacesRouter } from './workspaces.ts';

export interface V1Options {
  db: Database;
  /** Applied in order before any route. */
  middleware: MiddlewareHandler<AppEnv>[];
  /** Extra routes (tests, and later webhook groups) registered after the built-in ones. */
  routes?: (v1: AppRouter) => void;
}

export function v1Router({ db, middleware, routes }: V1Options): AppRouter {
  const v1 = createRouter();
  for (const handler of middleware) v1.use('*', handler);
  v1.route('/', meRouter(db));
  v1.route('/', workspacesRouter(db));
  routes?.(v1);
  return v1;
}
