// Request context (spike §1): AsyncLocalStorage carries correlation ids across `await` boundaries
// so every log line and span in a request or job shares one `requestId`.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestContext {
  readonly requestId: string;
  readonly workspaceId?: string;
  readonly userId?: string;
  readonly jobId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `ctx` as the active request context. */
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The active request context, or `undefined` outside a request or job. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Reuse a well-formed incoming `x-request-id`; otherwise mint a UUID. */
export function requestIdFrom(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER);
  return incoming !== null && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}
