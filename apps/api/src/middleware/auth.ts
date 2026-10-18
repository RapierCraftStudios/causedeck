// Who is calling (#14, spike §6). `resolvePrincipal` never rejects: it sets `principal` to the
// caller or `null`, and routes opt into `requireAuth` through `defineRoute`. A bearer token goes
// to the injected resolver (API keys / personal access tokens arrive later); without one, a bearer
// request is anonymous and so gets 401 on authenticated routes. Otherwise the Better Auth session
// cookie is checked.
import { toSessionUser, type SessionSource } from '@causedeck/auth/session';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv, Principal } from '../lib/openapi.ts';

/** Resolve an `Authorization: Bearer` token to a principal, or `null` when it is not valid. */
export type BearerResolver = (token: string) => Promise<Principal | null>;

export const rejectAllBearerTokens: BearerResolver = () => Promise.resolve(null);

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
