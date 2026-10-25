// `createApp(deps)` (#14): the Hono app behind `apps/api`. Everything stateful is injected so the
// tests run the real app against Testcontainers with fakes only at the edges.
//
// Global middleware order: logger (opens the request context) → request id → secure headers →
// CORS → body limit → health and docs (public) → `/v1` (see routes/v1/index.ts).
import type { SessionSource } from '@causedeck/auth/session';
import type { ReplayWindow } from '@causedeck/billing/webhook';
import type { Secret } from '@causedeck/config/env';
import type { InboundEmailProvider } from '@causedeck/core/email-intake';
import type { WhatsAppInboundProvider } from '@causedeck/core/whatsapp-link';
import type { JobSender } from '@causedeck/core/jobs';
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
import { apiKeyEnforcement } from './middleware/api-key.ts';
import { createApiKeyResolver, resolvePrincipal, type BearerResolver } from './middleware/auth.ts';
import { bodyLimit, type BodyLimitOptions } from './middleware/body-limit.ts';
import { allowedOrigins, cors, csrf } from './middleware/cors.ts';
import { errorHandler, notFoundHandler } from './middleware/error-handler.ts';
import { idempotency } from './middleware/idempotency.ts';
import { requestLogger } from './middleware/logger.ts';
import { rateLimit, type RateLimitOptions, type RateLimitRule } from './middleware/rate-limit.ts';
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
  /** Razorpay webhooks (#204). Without it `POST /v1/webhooks/razorpay` rejects every call. */
  billing?: BillingDeps;
  /** Inbound email (#530). Without a provider `POST /v1/inbound/email` rejects every call. */
  inboundEmail?: InboundEmailAppDeps;
  /** Inbound WhatsApp (#680). Without a provider `POST /v1/inbound/whatsapp` rejects every call. */
  inboundWhatsapp?: InboundWhatsAppAppDeps;
}

export interface InboundWhatsAppAppDeps {
  provider: WhatsAppInboundProvider | null;
  /** Sender for `whatsapp.intake`; defaults to the process-wide producer. */
  sender?: JobSender;
}

export interface InboundEmailAppDeps {
  provider: InboundEmailProvider | null;
  /** Sender for `email.intake`; defaults to the process-wide producer. */
  sender?: JobSender;
}

export interface BillingDeps {
  /** `webhookSecretFor(env)`: `RAZORPAY_WEBHOOK_SECRET`, or the mock secret in dev and CI. */
  webhookSecret: Secret;
  /** Sender for `billing.process-event`; defaults to the process-wide producer. */
  sender?: JobSender;
  replayWindow?: ReplayWindow;
}

/** Razorpay delivers in bursts from a few IPs; webhooks get a roomier anonymous limit. */
export const WEBHOOK_RATE_LIMIT: RateLimitRule = { limit: 1200, windowMs: 60_000 };

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
      resolvePrincipal({ auth: deps.auth, bearer: deps.bearer ?? createApiKeyResolver(db, now) }),
      csrf(origins),
      rateLimit({
        now: () => now().getTime(),
        ...deps.rateLimit,
        groups: {
          '/v1/webhooks': WEBHOOK_RATE_LIMIT,
          '/v1/inbound': WEBHOOK_RATE_LIMIT,
          ...deps.rateLimit?.groups,
        },
      }),
      apiKeyEnforcement({ db, now }),
      idempotency({ store: deps.idempotencyStore ?? createIdempotencyStore(db), now }),
    ],
    ...(deps.billing && { billing: { ...deps.billing, logger, now } }),
    ...(deps.inboundEmail && { inboundEmail: { ...deps.inboundEmail, logger, now } }),
    ...(deps.inboundWhatsapp && { inboundWhatsapp: { ...deps.inboundWhatsapp, logger, now } }),
    ...(deps.routes && { routes: deps.routes }),
  });
  app.route(`/${API_VERSION}`, v1);

  // Built after the routes so the document covers all of them.
  const document = buildOpenApiDocument(app);
  app.get(OPENAPI_PATH, (c) => c.json(document));
  app.get(DOCS_PATH, Scalar({ url: OPENAPI_PATH, pageTitle: 'CauseDeck API' }));

  return app;
}
