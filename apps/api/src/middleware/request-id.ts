// One request id per request: reuse the logger's context id (set by `honoRequestLogger`) so the
// log line, the `x-request-id` header and problem bodies all agree.
import { getRequestContext, REQUEST_ID_HEADER, requestIdFrom } from '@causedeck/observability';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../lib/openapi.ts';

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const id = getRequestContext()?.requestId ?? requestIdFrom(c.req.raw.headers);
  c.set('requestId', id);
  await next();
  c.header(REQUEST_ID_HEADER, id);
});
