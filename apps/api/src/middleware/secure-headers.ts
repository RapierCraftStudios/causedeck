// Baseline response headers (#14). Authenticated responses are never cached.
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../lib/openapi.ts';

export const secureHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'no-referrer');
  c.header('cross-origin-resource-policy', 'same-site');
  c.header('x-frame-options', 'DENY');
  if (c.get('principal')) c.header('cache-control', 'no-store');
});
