// The `/v1` router (#14). Additive changes only; breaking changes go to `/v2`. Middleware order:
// resolve the caller → CSRF (cookie callers) → rate limit (per user, per IP when anonymous) →
// idempotency (POST) → routes (each adds `requireAuth` unless `public: true`). Webhooks
// (`/v1/webhooks/*`) are public and verify a provider signature instead; CSRF and idempotency only
// act on signed-in callers, so they pass through.
import type { Database } from '@causedeck/db';
import type { MiddlewareHandler } from 'hono';

import { publicV1Router } from '../../public/v1/index.ts';
import { createRouter, type AppEnv, type AppRouter } from '../../lib/openapi.ts';

import { cspReportRouter, type CspReportDeps } from '../csp-report.ts';
import { inboundEmailRouter, type InboundEmailDeps } from '../inbound-email.ts';
import { inboundWhatsAppRouter, type InboundWhatsAppDeps } from '../inbound-whatsapp.ts';
import { razorpayWebhookRouter, type RazorpayWebhookDeps } from '../webhooks/razorpay.ts';

import { benchCardRouter } from './bench-card.ts';
import { billingRouter } from './billing.ts';
import { meRouter } from './me.ts';
import { webhookEndpointsRouter } from './webhook-endpoints.ts';
import { workspacesRouter } from './workspaces.ts';

export interface V1Options {
  db: Database;
  /** Applied in order before any route. */
  middleware: MiddlewareHandler<AppEnv>[];
  /** Razorpay webhook deps; without them the webhook route rejects every call with 400. */
  billing?: Omit<RazorpayWebhookDeps, 'db'>;
  /** Inbound email deps (#530); without a provider the route rejects every call with 400. */
  inboundEmail?: Omit<InboundEmailDeps, 'db'>;
  /** Inbound WhatsApp deps (#680); without a provider the route rejects every call with 400. */
  inboundWhatsapp?: Omit<InboundWhatsAppDeps, 'db'>;
  /** CSP violation reports (#104). */
  cspReport?: CspReportDeps;
  /** Extra routes (tests, and later webhook groups) registered after the built-in ones. */
  routes?: (v1: AppRouter) => void;
}

const noop = () => undefined;

export function v1Router({
  db,
  middleware,
  billing,
  inboundEmail,
  inboundWhatsapp,
  cspReport,
  routes,
}: V1Options): AppRouter {
  const v1 = createRouter();
  for (const handler of middleware) v1.use('*', handler);
  v1.route('/', meRouter(db));
  v1.route('/', workspacesRouter(db));
  v1.route('/', billingRouter(db));
  v1.route('/', publicV1Router(db));
  v1.route('/', benchCardRouter(db));
  v1.route('/', webhookEndpointsRouter(db));
  v1.route(
    '/',
    razorpayWebhookRouter({
      db,
      ...(billing ?? { webhookSecret: null, logger: { info: noop, warn: noop } }),
    }),
  );
  v1.route(
    '/',
    inboundEmailRouter({
      db,
      ...(inboundEmail ?? { provider: null, logger: { info: noop, warn: noop } }),
    }),
  );
  v1.route(
    '/',
    inboundWhatsAppRouter({
      db,
      ...(inboundWhatsapp ?? { provider: null, logger: { info: noop, warn: noop } }),
    }),
  );
  v1.route('/', cspReportRouter(cspReport ?? { logger: { info: noop, warn: noop } }));
  routes?.(v1);
  return v1;
}
