// `Idempotency-Key` for POST (#14): a repeated key with the same request replays the stored
// response (`Idempotency-Replayed: true`); the same key with a different request, or while the
// first is still running, is a 409 `CONFLICT`. Keys are per user and expire after 24 h. 5xx
// responses are not stored, so the client can retry them with the same key.
import { createHash } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import { ConflictError, ValidationError } from '../errors.ts';
import {
  IN_PROGRESS_STATUS,
  type IdempotencyStore,
  type StoredApiResponse,
} from '../lib/idempotency-store.ts';
import type { AppEnv } from '../lib/openapi.ts';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAYED_HEADER = 'idempotency-replayed';
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

/** Headers worth replaying; hop-by-hop and per-request ones are regenerated. */
const REPLAYED_HEADERS = new Set(['content-type', 'location', 'etag', 'last-modified']);

export interface IdempotencyOptions {
  store: IdempotencyStore;
  now?: () => Date;
}

export function requestHash(method: string, path: string, body: string): string {
  return createHash('sha256').update(`${method}\n${path}\n${body}`).digest('hex');
}

function replay(stored: StoredApiResponse): Response {
  const headers = new Headers(stored.headers);
  headers.set(REPLAYED_HEADER, 'true');
  return new Response(stored.body === '' ? null : stored.body, {
    status: stored.status,
    headers,
  });
}

export function idempotency({
  store,
  now = () => new Date(),
}: IdempotencyOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_HEADER);
    const principal = c.get('principal');
    // Anonymous requests fall through: authenticated routes reject them anyway.
    if (c.req.method !== 'POST' || key === undefined || principal === null) return next();
    if (!KEY_PATTERN.test(key)) {
      throw new ValidationError([
        { path: `header.${IDEMPOTENCY_HEADER}`, message: 'Must be 1-255 visible ASCII characters' },
      ]);
    }

    const userId = principal.user.id;
    const path = new URL(c.req.url).pathname;
    const hash = requestHash(c.req.method, path, await c.req.text());

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const at = now();
      await store.dropExpired(userId, key, at);
      const existing = await store.get(userId, key);
      if (existing) {
        if (existing.requestHash !== hash) {
          throw new ConflictError('This Idempotency-Key was used with a different request.');
        }
        if (existing.response.status === IN_PROGRESS_STATUS) {
          throw new ConflictError('A request with this Idempotency-Key is still in progress.');
        }
        c.res = replay(existing.response);
        return;
      }
      const claimed = await store.claim({
        userId,
        key,
        // Membership is not verified yet at this point, so the workspace is not recorded here.
        workspaceId: null,
        method: c.req.method,
        path,
        requestHash: hash,
        now: at,
      });
      if (!claimed) continue;

      try {
        await next();
      } catch (error) {
        await store.release(userId, key);
        throw error;
      }
      const res = c.res;
      if (res.status >= 500) {
        await store.release(userId, key);
        return;
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((value, name) => {
        if (REPLAYED_HEADERS.has(name)) headers[name] = value;
      });
      await store.complete(userId, key, {
        status: res.status,
        headers,
        body: await res.clone().text(),
      });
      return;
    }
    throw new ConflictError('A request with this Idempotency-Key is still in progress.');
  };
}
