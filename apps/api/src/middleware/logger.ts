// One log line and server span per request (#13 `honoRequestLogger`); it also opens the request
// context whose id `requestId` reuses, so it must be the first middleware.
import { honoRequestLogger, type Logger } from '@causedeck/observability';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../lib/openapi.ts';

export function requestLogger(logger: Logger): MiddlewareHandler<AppEnv> {
  const log = honoRequestLogger(logger);
  return (c, next) => log(c, next);
}
