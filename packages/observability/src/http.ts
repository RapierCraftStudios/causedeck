// Request logging for Next route handlers and Hono (spike §1): one line per request with method,
// path template, status, duration and requestId. Query strings are never logged; health probes
// log at `debug` so they do not drown real traffic.
import { SpanKind } from '@opentelemetry/api';
import type { Logger } from 'pino';

import { REQUEST_ID_HEADER, requestIdFrom, withRequestContext } from './context.ts';
import { isHealthPath, type Handler } from './health.ts';
import { recordHttpServerDuration, withSpan } from './otel.ts';

export interface RequestLogOptions {
  /** Route template, e.g. `/matters/:id`. Defaults to the URL pathname. */
  readonly route?: string;
}

export interface RequestLogLine {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
}

function withRequestIdHeader(response: Response, requestId: string): Response {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } catch {
    // Immutable headers (e.g. a proxied `fetch` response): copy into a mutable response.
    const copy = new Response(response.body, response);
    copy.headers.set(REQUEST_ID_HEADER, requestId);
    return copy;
  }
}

/**
 * Run `handle` inside a request context and a server span, then log one line. Returns whatever
 * `handle` returns; a thrown error is logged with status 500 and rethrown.
 */
async function observe<T>(
  logger: Logger,
  request: Request,
  route: string | undefined,
  handle: (requestId: string) => Promise<{ value: T; status: number }>,
): Promise<T> {
  const requestId = requestIdFrom(request.headers);
  const { pathname } = new URL(request.url);
  const path = route ?? pathname;
  const method = request.method;
  const level = isHealthPath(pathname) ? 'debug' : 'info';

  return withRequestContext({ requestId }, () =>
    withSpan(
      `${method} ${path}`,
      async (span) => {
        const start = performance.now();
        let status = 500;
        let failure: unknown;
        try {
          const result = await handle(requestId);
          status = result.status;
          return result.value;
        } catch (error) {
          failure = error;
          throw error;
        } finally {
          const durationMs = Math.round((performance.now() - start) * 100) / 100;
          span.setAttribute('http.response.status_code', status);
          recordHttpServerDuration(durationMs, {
            'http.request.method': method,
            'http.route': path,
            'http.response.status_code': status,
          });
          const line: RequestLogLine = { method, path, status, durationMs, requestId };
          if (failure === undefined) logger[level](line, 'request completed');
          else logger.error({ ...line, err: failure }, 'request failed');
        }
      },
      {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': method, 'http.route': path, 'url.path': pathname },
      },
    ),
  );
}

/** Wrap a Next.js route handler (`Request → Response`) with request logging and correlation. */
export function withRequestLogging(
  logger: Logger,
  handler: Handler,
  options: RequestLogOptions = {},
): Handler {
  return (request) =>
    observe(logger, request, options.route, async (requestId) => {
      const response = withRequestIdHeader(await handler(request), requestId);
      return { value: response, status: response.status };
    });
}

/** The subset of Hono's `Context` this middleware uses, so the package does not depend on Hono. */
export interface HonoLikeContext {
  readonly req: { readonly raw: Request; readonly routePath?: string };
  readonly res: Response;
  header(name: string, value: string): void;
}

export type HonoLikeMiddleware = (c: HonoLikeContext, next: () => Promise<void>) => Promise<void>;

/** Hono middleware: `app.use(honoRequestLogger(logger))`. */
export function honoRequestLogger(logger: Logger): HonoLikeMiddleware {
  return (c, next) =>
    observe(logger, c.req.raw, undefined, async (requestId) => {
      await next();
      c.header(REQUEST_ID_HEADER, requestId);
      return { value: undefined, status: c.res.status };
    });
}
