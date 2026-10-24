// Who is calling (#14, spike §6). `resolvePrincipal` never rejects: it sets `principal` to the
// caller or `null`, and routes opt into `requireAuth` through `defineRoute`. A bearer token goes
// to the injected resolver (API keys / personal access tokens arrive later); without one, a bearer
// request is anonymous and so gets 401 on authenticated routes. Otherwise the Better Auth session
// cookie is checked.
import { toSessionUser, type SessionSource } from '@causedeck/auth/session';
import { authenticateApiKey, findApiKeyIssuer } from '@causedeck/core/api-keys';
import type { Database } from '@causedeck/db';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv, Principal } from '../lib/openapi.ts';

/** Resolve an `Authorization: Bearer` token to a principal, or `null` when it is not valid. */
export type BearerResolver = (token: string) => Promise<Principal | null>;

export const rejectAllBearerTokens: BearerResolver = () => Promise.resolve(null);

/**
 * Resolves a workspace API key (#624) to a principal. The caller is the member who issued the key,
 * so a key whose issuer has left the workspace fails `requireWorkspace`'s membership check.
 */
export function createApiKeyResolver(
  db: Database,
  now: () => Date = () => new Date(),
): BearerResolver {
  return async (token) => {
    const apiKey = await authenticateApiKey(db, token, now());
    if (apiKey === null) return null;
    const row = await findApiKeyIssuer(db, apiKey.createdBy);
    return row ? { user: toSessionUser(row), via: 'bearer', apiKey } : null;
  };
}

export interface ResolvePrincipalOptions {
  auth: SessionSource;
  bearer?: BearerResolver;
}

const BEARER = /^Bearer\s+(\S+)\s*$/i;

export async function principalFrom(
  headers: Headers,
  { auth, bearer = rejectAllBearerTokens }: ResolvePrincipalOptions,
): Promise<Principal | null> {
  const authorization = headers.get('authorization');
  if (authorization !== null) {
    const token = BEARER.exec(authorization)?.[1];
    if (token === undefined) return null;
    const principal = await bearer(token);
    return principal ? { ...principal, via: 'bearer' } : null;
  }
  if (!headers.has('cookie')) return null;
  const session = await auth.api.getSession({ headers });
  return session ? { user: toSessionUser(session.user), via: 'cookie' } : null;
}

export function resolvePrincipal(options: ResolvePrincipalOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('principal', await principalFrom(c.req.raw.headers, options));
    await next();
  };
}
