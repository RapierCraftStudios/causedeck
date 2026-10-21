// The staff gate (#309, part of #27): deny by default. proxy.ts runs `decide` on every request
// except `/healthz`; the first failed check ends in the generic 404 (`notFoundResponse`).
//   1. Cloudflare Access JWT, when `CF_ACCESS_AUD` is set.
//   2. Client IP inside `ADMIN_IP_ALLOWLIST`, when set.
//   3. A session validated against the database (not just a cookie).
//   4. An enabled `staff_user` row.
//   5. 2FA: enrolled (`user.twoFactorEnabled`) and verified for this session (`cd_admin_2fa`).
// Static assets need only 1-2. The sign-in pages and the Better Auth endpoints they call are open
// to anyone signed out who passed 1-2; a signed-in non-staff user gets 404 there too. Outside
// production, and only for the CLI-seeded dev staff account (DEV_STAFF_EMAIL), 2 and 5 are skipped.
import type { CfAccessVerifier } from './cf-access.ts';
import { CF_ACCESS_HEADER } from './cf-access.ts';
import type { IpAllowlist } from './ip-allowlist.ts';
import { clientIp } from './ip-allowlist.ts';
import { DEV_STAFF_EMAIL } from './roles.ts';
import { ADMIN_TWO_FACTOR_COOKIE, verifyTwoFactorCookie } from './two-factor.ts';

export const VERIFY_TWO_FACTOR_PATH = '/verify-2fa';
export const SIGN_IN_PATH = '/sign-in';

/** Better Auth endpoints the sign-in flow needs; every other `/api/auth/*` path is closed. */
const OPEN_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/api/auth/sign-in/magic-link',
  '/api/auth/magic-link/verify',
  '/api/auth/sign-out',
  '/api/auth/get-session',
]);
const DEV_AUTH_PATHS: ReadonlySet<string> = new Set(['/api/auth/dev/sign-in']);
const TWO_FACTOR_PATHS: ReadonlySet<string> = new Set([
  VERIFY_TWO_FACTOR_PATH,
  '/api/auth/two-factor/verify-totp',
]);

/**
 * - `probe`: liveness, never gated.
 * - `asset`: Next.js static files; network checks only.
 * - `public`: sign-in; open when signed out.
 * - `two-factor`: the TOTP step; staff with 2FA enrolled.
 * - `closed`: always 404.
 * - `console`: everything else; every check.
 */
export type PathClass = 'probe' | 'asset' | 'public' | 'two-factor' | 'closed' | 'console';

export function classifyPath(pathname: string, { production }: { production: boolean }): PathClass {
  if (pathname === '/healthz') return 'probe';
  if (pathname.startsWith('/_next/') || pathname === '/favicon.ico') return 'asset';
  if (pathname === SIGN_IN_PATH || OPEN_AUTH_PATHS.has(pathname)) return 'public';
  if (!production && DEV_AUTH_PATHS.has(pathname)) return 'public';
  if (TWO_FACTOR_PATHS.has(pathname)) return 'two-factor';
  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) return 'closed';
  return 'console';
}

export interface GateSession {
  session: { id: string };
  user: { id: string; email: string; twoFactorEnabled?: boolean | null | undefined };
}

export interface GateRequest {
  pathname: string;
  headers: Headers;
  cookie: (name: string) => string | undefined;
}

export interface GateConfig {
  production: boolean;
  /** BETTER_AUTH_SECRET: keys the 2FA cookie. */
  secret: string;
  ipAllowlist?: IpAllowlist | undefined;
  cfAccess?: CfAccessVerifier | undefined;
  now?: () => number;
}

export interface GateDeps {
  getSession: (headers: Headers) => Promise<GateSession | null>;
  isActiveStaff: (userId: string) => Promise<boolean>;
}

export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'deny' }
  | { kind: 'redirect'; location: typeof VERIFY_TWO_FACTOR_PATH };

const ALLOW: GateDecision = { kind: 'allow' };
const DENY: GateDecision = { kind: 'deny' };

export async function decide(
  request: GateRequest,
  config: GateConfig,
  deps: GateDeps,
): Promise<GateDecision> {
  const kind = classifyPath(request.pathname, { production: config.production });
  if (kind === 'probe') return ALLOW;
  if (kind === 'closed') return DENY;

  // 1. Cloudflare Access applies to every gated request, assets included.
  if (config.cfAccess && !(await config.cfAccess(request.headers.get(CF_ACCESS_HEADER)))) {
    return DENY;
  }

  // 2. The IP allowlist, except for the dev staff account outside production (decided below,
  // since it needs the session).
  const ipAllowed = config.ipAllowlist ? config.ipAllowlist(clientIp(request.headers)) : true;
  if (kind === 'asset') return ipAllowed ? ALLOW : DENY;

  // 3. The session, validated against the database.
  const current = await safeSession(deps, request.headers);
  const devStaff =
    !config.production && current !== null && current.user.email.toLowerCase() === DEV_STAFF_EMAIL;
  if (!ipAllowed && !devStaff) return DENY;

  if (kind === 'public') {
    if (current === null) return ALLOW;
    // A signed-in non-staff user learns nothing, not even that this is a sign-in page.
    return (await deps.isActiveStaff(current.user.id)) ? ALLOW : DENY;
  }

  if (current === null) return DENY;

  // 4. An enabled staff_user row.
  if (!(await deps.isActiveStaff(current.user.id))) return DENY;
  if (devStaff) return ALLOW;

  // 5. 2FA: enrolled, and verified for this session.
  if (current.user.twoFactorEnabled !== true) return DENY;
  if (kind === 'two-factor') return ALLOW;
  const now = config.now?.() ?? Date.now();
  const verified = verifyTwoFactorCookie(
    config.secret,
    request.cookie(ADMIN_TWO_FACTOR_COOKIE),
    current.session.id,
    now,
  );
  if (verified) return ALLOW;
  // Only page navigations go to the TOTP step; an API call without it is just a 404.
  return request.pathname.startsWith('/api/')
    ? DENY
    : { kind: 'redirect', location: VERIFY_TWO_FACTOR_PATH };
}

/** A session lookup that fails (bad cookie, database error) counts as no session. */
async function safeSession(deps: GateDeps, headers: Headers): Promise<GateSession | null> {
  try {
    return await deps.getSession(headers);
  } catch {
    return null;
  }
}
