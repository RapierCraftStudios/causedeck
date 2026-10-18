// CORS and CSRF (#14). Only the configured app origins may call the API from a browser, with
// credentials, and never via a wildcard. Cookie-authenticated unsafe requests must carry a
// matching `Origin` (bearer tokens are not ambient credentials, so they are exempt).
import { REQUEST_ID_HEADER } from '@causedeck/observability';
import type { MiddlewareHandler } from 'hono';
import { cors as honoCors } from 'hono/cors';

import { ForbiddenError } from '../errors.ts';
import type { AppEnv } from '../lib/openapi.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Normalise configured URLs to bare origins. */
export function allowedOrigins(urls: readonly string[]): ReadonlySet<string> {
  return new Set(urls.map((url) => new URL(url).origin));
}

export function cors(origins: ReadonlySet<string>): MiddlewareHandler<AppEnv> {
  return honoCors({
    origin: (origin) => (origins.has(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'x-workspace-id',
      REQUEST_ID_HEADER,
    ],
    exposeHeaders: [
      REQUEST_ID_HEADER,
      'ratelimit-limit',
      'ratelimit-remaining',
      'ratelimit-reset',
      'retry-after',
      'idempotency-replayed',
    ],
    maxAge: 600,
  });
}

/** Runs after `resolvePrincipal`: 403 for cookie-authenticated unsafe requests from elsewhere. */
export function csrf(origins: ReadonlySet<string>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const principal = c.get('principal');
    if (principal?.via === 'cookie' && !SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin === undefined || !origins.has(origin)) {
        throw new ForbiddenError('Cross-site request rejected: Origin does not match.');
      }
    }
    await next();
  };
}
