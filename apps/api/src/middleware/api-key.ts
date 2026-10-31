// Public API key enforcement (#624, #487 part 1). Runs after `resolvePrincipal` and the rate limit
// and does nothing for cookie callers. For an API key it confines the request to the public API
// surface and to the key's own workspace, then enforces the key's monthly quota and bills one
// `api.calls` usage unit per request (idempotent per request id). Scopes are checked per route by
// `requireScope`.
import { consumeApiCall } from '@causedeck/core/api-keys';
import type { Database } from '@causedeck/db';
import type { MiddlewareHandler } from 'hono';

import { ApiError, ForbiddenError } from '../errors.ts';
import type { AppEnv } from '../lib/openapi.ts';

import { longestPrefixMatch } from './body-limit.ts';
import { WORKSPACE_HEADER } from './workspace.ts';

/**
 * The only `/v1` paths an API key may reach: the public data API (#625) and webhook management
 * (#626). Every other route (members, billing, settings) is for signed-in people.
 */
export const API_KEY_ROUTE_PREFIXES = [
  '/v1/cases',
  '/v1/causelists',
  '/v1/orders',
  '/v1/notices',
  '/v1/research',
  '/v1/webhook-endpoints',
] as const;

const WORKSPACE_PATH = /^\/v1\/workspaces\/([^/]+)/;

export interface ApiKeyOptions {
  db: Database;
  now?: () => Date;
}

export function apiKeyEnforcement({
  db,
  now = () => new Date(),
}: ApiKeyOptions): MiddlewareHandler<AppEnv> {
  const allowed = Object.fromEntries(API_KEY_ROUTE_PREFIXES.map((prefix) => [prefix, true]));
  return async (c, next) => {
    const apiKey = c.get('principal')?.apiKey;
    if (apiKey === undefined) return next();

    if (longestPrefixMatch(c.req.path, allowed) === undefined) {
      throw new ForbiddenError('API keys can only call the public API.');
    }
    const requested = [c.req.header(WORKSPACE_HEADER), WORKSPACE_PATH.exec(c.req.path)?.[1]].filter(
      (value) => value !== undefined,
    );
    if (requested.some((workspaceId) => workspaceId !== apiKey.workspaceId)) {
      throw new ForbiddenError('This API key belongs to another workspace.');
    }

    const result = await consumeApiCall(
      { db, workspaceId: apiKey.workspaceId, now },
      apiKey,
      c.get('requestId'),
    );
    if (!result.allowed) {
      throw new ApiError(429, 'RATE_LIMITED', 'The monthly quota for this API key is used up.', {
        headers: { 'x-quota-limit': String(result.quota), 'x-quota-used': String(result.used) },
      });
    }
    c.header('x-quota-used', String(result.used));
    return next();
  };
}
