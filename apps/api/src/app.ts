// `createApp(deps)` (#14): the Hono app behind `apps/api`. Everything stateful is injected so the
// tests run the real app against Testcontainers with fakes only at the edges.
//
// Global middleware order: logger (opens the request context) → request id → secure headers →
// CORS → body limit → health and docs (public) → `/v1` (see routes/v1/index.ts).
import type { SessionSource } from '@causedeck/auth/session';
import type { Database } from '@causedeck/db';
import { createHealthHandlers, type HealthCheck, type Logger } from '@causedeck/observability';
import { Scalar } from '@scalar/hono-api-reference';
import { sql } from 'drizzle-orm';

import { createIdempotencyStore, type IdempotencyStore } from './lib/idempotency-store.ts';
import {
  API_VERSION,
  buildOpenApiDocument,
  createRouter,
  registerSecuritySchemes,
  type AppRouter,
} from './lib/openapi.ts';
import { resolvePrincipal, type BearerResolver } from './middleware/auth.ts';
import { bodyLimit, type BodyLimitOptions } from './middleware/body-limit.ts';
import { allowedOrigins, cors, csrf } from './middleware/cors.ts';
import { errorHandler, notFoundHandler } from './middleware/error-handler.ts';
import { idempotency } from './middleware/idempotency.ts';
import { requestLogger } from './middleware/logger.ts';
import { rateLimit, type RateLimitOptions } from './middleware/rate-limit.ts';
import { requestId } from './middleware/request-id.ts';
import { secureHeaders } from './middleware/secure-headers.ts';
import { v1Router } from './routes/v1/index.ts';

export interface AppDeps {
  db: Database;
  /** Better Auth (or any `SessionSource`) for cookie sessions. */
  auth: SessionSource;
  logger: Logger;
  /** Browser origins allowed by CORS and CSRF; normally just `APP_URL`. */
  allowedOrigins: readonly string[];
  bearer?: BearerResolver;
  rateLimit?: RateLimitOptions;
  bodyLimit?: BodyLimitOptions;
  idempotencyStore?: IdempotencyStore;
  now?: () => Date;
  /** Extra readiness checks; `db` (`select 1`) is always registered. */
  readyChecks?: Record<string, HealthCheck>;
  /** Extra `/v1` routes, registered after the built-in ones. */
  routes?: (v1: AppRouter) => void;
}

export const OPENAPI_PATH = '/openapi.json';
export const DOCS_PATH = '/docs';

export function createApp(deps: AppDeps): AppRouter {
  const { db, logger } = deps;
  const origins = allowedOrigins(deps.allowedOrigins);
  const health = createHealthHandlers({
    checks: {
      db: async () => {
        await db.execute(sql`select 1`);
      },
      ...deps.readyChecks,
    },
  });

  const app = createRouter();
  registerSecuritySchemes(app);
  app.onError(errorHandler(logger));
  app.notFound(notFoundHandler);

  app.use('*', requestLogger(logger));
  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('principal', null);
    await next();
  });
  app.use('*', secureHeaders);
  app.use('*', cors(origins));
  app.use('*', bodyLimit(deps.bodyLimit));

  app.get('/healthz', (c) => health.healthz(c.req.raw));
  app.get('/readyz', (c) => health.readyz(c.req.raw));

  const now = deps.now ?? (() => new Date());
  const v1 = v1Router({
    db,
    middleware: [
      resolvePrincipal({ auth: deps.auth, ...(deps.bearer && { bearer: deps.bearer }) }),
      csrf(origins),
      rateLimit({ now: () => now().getTime(), ...deps.rateLimit }),
      idempotency({ store: deps.idempotencyStore ?? createIdempotencyStore(db), now }),
    ],
    ...(deps.routes && { routes: deps.routes }),
  });
  app.route(`/${API_VERSION}`, v1);

  // Built after the routes so the document covers all of them.
  const document = buildOpenApiDocument(app);
  app.get(OPENAPI_PATH, (c) => c.json(document));
  app.get(DOCS_PATH, Scalar({ url: OPENAPI_PATH, pageTitle: 'CauseDeck API' }));

  return app;
}
