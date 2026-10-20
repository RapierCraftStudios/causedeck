// Next.js 16 proxy (formerly `middleware.ts`; runs on the Node runtime): the staff gate (#309).
// Deny by default: `decide` (lib/gate.ts) runs every check and anything short of `allow` is the
// generic 404, or for enrolled staff who have not passed the TOTP step yet a redirect to it.
// Allowed responses get a per-request nonce CSP shared with the renderer via `x-nonce`. Every
// response, the 404 included, carries `noindex`, `no-store` and `frame-ancestors 'none'`.
import { isActiveStaff } from '@causedeck/core/support';
import { db } from '@causedeck/core/runtime';
import { NextResponse, type NextRequest } from 'next/server';

import { sessionFor } from './lib/auth.ts';
import { createCfAccessVerifier, type CfAccessVerifier } from './lib/cf-access.ts';
import { applySecurityHeaders, buildCsp, createNonce, NOT_FOUND_CSP } from './lib/csp.ts';
import { adminEnv, isDev } from './lib/env.ts';
import { decide, type GateConfig, type GateDeps } from './lib/gate.ts';
import { parseIpAllowlist } from './lib/ip-allowlist.ts';
import { logger } from './lib/health.ts';
import { notFoundResponse } from './lib/not-found-response.ts';

let settings: GateConfig | undefined;

/** Gate settings from the env, built once per process. */
function gateConfig(): GateConfig {
  if (!settings) {
    const env = adminEnv();
    let cfAccess: CfAccessVerifier | undefined;
    if (env.CF_ACCESS_AUD !== undefined && env.CF_ACCESS_TEAM_DOMAIN !== undefined) {
      cfAccess = createCfAccessVerifier({
        teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
        aud: env.CF_ACCESS_AUD,
      });
    }
    settings = {
      production: env.NODE_ENV === 'production',
      secret: env.BETTER_AUTH_SECRET.reveal(),
      ipAllowlist:
        env.ADMIN_IP_ALLOWLIST === undefined ? undefined : parseIpAllowlist(env.ADMIN_IP_ALLOWLIST),
      cfAccess,
    };
  }
  return settings;
}

const deps: GateDeps = {
  getSession: sessionFor,
  isActiveStaff: (userId) => isActiveStaff(db, userId),
};

export async function proxy(request: NextRequest): Promise<Response> {
  let decision: Awaited<ReturnType<typeof decide>>;
  try {
    decision = await decide(
      {
        pathname: request.nextUrl.pathname,
        headers: request.headers,
        cookie: (name) => request.cookies.get(name)?.value,
      },
      gateConfig(),
      deps,
    );
  } catch (error) {
    // Fail closed: a gate that cannot decide denies.
    logger.error(
      { err: error instanceof Error ? { name: error.name, message: error.message } : {} },
      'admin gate failed',
    );
    return notFoundResponse();
  }

  if (decision.kind === 'deny') return notFoundResponse();
  if (decision.kind === 'redirect') {
    const response = NextResponse.redirect(new URL(decision.location, request.url));
    applySecurityHeaders(response.headers, NOT_FOUND_CSP);
    return response;
  }

  const nonce = createNonce();
  const csp = buildCsp(nonce, { dev: isDev() });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js reads the nonce from the request CSP header and stamps it on its own scripts.
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(response.headers, csp);
  return response;
}

export const config = {
  // Everything but the liveness probe: static assets still pass the network checks.
  matcher: ['/((?!healthz$).*)'],
};
