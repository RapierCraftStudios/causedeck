// Request body limits (#14): 1 MB by default. Route groups (webhooks) may raise or lower theirs by
// path prefix; the most specific prefix wins.
import type { MiddlewareHandler } from 'hono';
import { bodyLimit as honoBodyLimit } from 'hono/body-limit';

import { PayloadTooLargeError } from '../errors.ts';
import type { AppEnv } from '../lib/openapi.ts';

export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

export interface BodyLimitOptions {
  maxBytes?: number;
  /** Path prefix → limit in bytes, e.g. `{ '/v1/webhooks': 5 * 1024 * 1024 }`. */
  groups?: Record<string, number>;
}

/** A body limit for one group: rejects with a 413 `PAYLOAD_TOO_LARGE` problem. */
export function bodyLimitOf(maxBytes: number): MiddlewareHandler<AppEnv> {
  return honoBodyLimit({
    maxSize: maxBytes,
    onError: () => {
      throw new PayloadTooLargeError(maxBytes);
    },
  });
}

export function longestPrefixMatch<T>(
  path: string,
  groups: Record<string, T> | undefined,
): [string, T] | undefined {
  let best: [string, T] | undefined;
  for (const [prefix, value] of Object.entries(groups ?? {})) {
    const matches =
      path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
    if (matches && (best === undefined || prefix.length > best[0].length)) best = [prefix, value];
  }
  return best;
}

export function bodyLimit({
  maxBytes = DEFAULT_BODY_LIMIT_BYTES,
  groups,
}: BodyLimitOptions = {}): MiddlewareHandler<AppEnv> {
  const fallback = bodyLimitOf(maxBytes);
  const perGroup = new Map(
    Object.entries(groups ?? {}).map(([prefix, bytes]) => [prefix, bodyLimitOf(bytes)]),
  );
  return (c, next) => {
    const match = longestPrefixMatch(c.req.path, groups);
    const limiter = match ? perGroup.get(match[0]) : undefined;
    return (limiter ?? fallback)(c, next);
  };
}
