// Better Auth server (#152, spike §1/§6, ADR 0004): magic link, passkeys, Google behind a switch,
// organizations as workspaces with the `roles.ts` roles, TOTP 2FA, cookie sessions and database
// rate limiting. Server-only: import from `@causedeck/auth/server`. See docs/engineering/auth.md.
import type { Secret, ServerEnv } from '@causedeck/config/env';
import type { Database } from '@causedeck/db';
import { schema } from '@causedeck/db';
import { passkey } from '@better-auth/passkey';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { magicLink, organization, twoFactor } from 'better-auth/plugins';

import { DEV_SIGN_IN_PATH, devSignIn } from './dev-provider';
import { consoleLogger, type AuthLogger, type Mailer } from './mailer';
import { AUTH_EMAIL_KEYS, toAuthLocale } from './messages';
import {
  consumeRateLimit,
  MAGIC_LINK_EMAIL_LIMIT,
  MAGIC_LINK_IP_LIMIT,
  magicLinkEmailKey,
  RATE_LIMIT_MESSAGE,
} from './rate-limit';
import { ac, isRole, roles } from './roles';

export const MAGIC_LINK_PATH = '/sign-in/magic-link';
export const MAGIC_LINK_EXPIRES_IN_SECONDS = 10 * 60;
export const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

type GoogleEnv =
  | { AUTH_GOOGLE_ENABLED: false }
  | { AUTH_GOOGLE_ENABLED: true; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: Secret };

/** The env keys auth reads. Secrets arrive only as #4 `Secret` values. */
export type AuthEnv = Pick<ServerEnv, 'NODE_ENV' | 'APP_URL' | 'BETTER_AUTH_SECRET'> & GoogleEnv;

export type SignInMethod = 'magic_link' | 'passkey' | 'google' | 'two_factor' | 'dev' | 'unknown';

/** One auth security event as plain data; `@causedeck/core` turns it into an audit row (#228). */
export interface SecurityEventInput {
  userId?: string | null;
  sessionId?: string;
  passkeyId?: string;
  /** Hashed by the recorder; never stored raw. */
  email?: string;
  method?: SignInMethod;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Where auth security events go. Injected by the composition roots (`@causedeck/core`
 * `createSecurityEventRecorder`), because core depends on auth and auth may not import core.
 */
export interface SecurityEventRecorder {
  signInSucceeded(event: SecurityEventInput): Promise<void>;
  signInFailed(event: SecurityEventInput): Promise<void>;
  magicLinkRequested(event: SecurityEventInput): Promise<void>;
  passkeyAdded(event: SecurityEventInput): Promise<void>;
  passkeyRemoved(event: SecurityEventInput): Promise<void>;
  twoFactorEnabled(event: SecurityEventInput): Promise<void>;
  twoFactorDisabled(event: SecurityEventInput): Promise<void>;
  sessionRevoked(event: SecurityEventInput): Promise<void>;
}

const resolved = () => Promise.resolve();

export const noopSecurityEventRecorder: SecurityEventRecorder = {
  signInSucceeded: resolved,
  signInFailed: resolved,
  magicLinkRequested: resolved,
  passkeyAdded: resolved,
  passkeyRemoved: resolved,
  twoFactorEnabled: resolved,
  twoFactorDisabled: resolved,
  sessionRevoked: resolved,
};

export interface CreateAuthDeps {
  db: Database;
  env: AuthEnv;
  mailer: Mailer;
  logger?: AuthLogger;
  /** Defaults to `noopSecurityEventRecorder`. */
  securityEvents?: SecurityEventRecorder;
}

const MAGIC_LINK_VERIFY_PATH = '/magic-link/verify';
const PASSKEY_SIGN_IN_PATH = '/passkey/verify-authentication';
const TWO_FACTOR_VERIFY_PATHS: ReadonlySet<string> = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-otp',
  '/two-factor/verify-backup-code',
]);
const REVOKE_PATHS: ReadonlySet<string> = new Set([
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
]);

/** The sign-in method behind the request that created a session. */
export function signInMethod(path: string | undefined): SignInMethod {
  if (path === MAGIC_LINK_VERIFY_PATH) return 'magic_link';
  if (path === PASSKEY_SIGN_IN_PATH) return 'passkey';
  if (path?.startsWith('/callback/')) return 'google';
  if (path !== undefined && TWO_FACTOR_VERIFY_PATHS.has(path)) return 'two_factor';
  // Literal `process.env.NODE_ENV` so production bundles drop the dev path string with the dev provider.
  // eslint-disable-next-line no-process-env -- must stay a literal for bundler dead-code elimination.
  if (process.env.NODE_ENV !== 'production' && path === DEV_SIGN_IN_PATH) return 'dev';
  return 'unknown';
}

interface RequestLike {
  path?: string;
  headers?: Headers | undefined;
  request?: Request | undefined;
}

/** Client IP (first `x-forwarded-for` hop, else `x-real-ip`), user agent and request id. */
function requestInfo(ctx: RequestLike | null | undefined): Omit<SecurityEventInput, 'userId'> {
  const headers = ctx?.headers ?? ctx?.request?.headers;
  if (!headers) return {};
  const info: Omit<SecurityEventInput, 'userId'> = {};
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip')?.trim();
  if (ip) info.ip = ip;
  const userAgent = headers.get('user-agent');
  if (userAgent) info.userAgent = userAgent;
  const requestId = headers.get('x-request-id');
  if (requestId) info.requestId = requestId;
  return info;
}

/**
 * True when an endpoint's result is a failure: an API error, or a redirect carrying `?error=`
 * (magic-link verify redirects to its error callback instead of throwing).
 */
function failed(returned: unknown): boolean {
  if (!isAPIError(returned)) return false;
  if (returned.statusCode >= 400) return true;
  const headers = (returned as { headers?: Headers }).headers;
  const location = headers instanceof Headers ? headers.get('location') : null;
  return location !== null && /[?&]error=/.test(location);
}

function roleList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map((r) => r.trim());
  return [];
}

/**
 * Better Auth also accepts its built-in `admin`/`member` roles; only `ROLES` are valid here. Runs
 * for HTTP calls and server-only `auth.api` calls alike (e.g. `addMember`, which has no path).
 */
function assertKnownRoles(value: unknown): void {
  const requested = roleList(value);
  if (requested.length === 0 || !requested.every(isRole)) {
    throw new APIError('BAD_REQUEST', { code: 'ROLE_NOT_FOUND', message: 'Unknown role' });
  }
}

/** The `hooks.after` view of a request that `securityEventHook` reads. */
export interface SecurityHookContext extends RequestLike {
  path: string;
  body?: unknown;
  context: { returned?: unknown; session?: { user: { id: string } } | null };
}

/**
 * Security events from endpoint results (#228): magic link requested, passkey added/removed and
 * failed sign-ins. Success paths are fail-closed (a recorder error fails the request); a failed
 * sign-in is logged instead, so the original auth error still reaches the client.
 */
export function securityEventHook(securityEvents: SecurityEventRecorder, logger: AuthLogger) {
  return async (ctx: SecurityHookContext): Promise<void> => {
    const returned = ctx.context.returned;
    const body = ctx.body as Record<string, unknown> | undefined;
    const userId = ctx.context.session?.user.id ?? null;
    const info = requestInfo(ctx);
    if (failed(returned)) {
      if (
        ctx.path === MAGIC_LINK_VERIFY_PATH ||
        ctx.path === PASSKEY_SIGN_IN_PATH ||
        TWO_FACTOR_VERIFY_PATHS.has(ctx.path)
      ) {
        await securityEvents
          .signInFailed({ ...info, userId, method: signInMethod(ctx.path) })
          .catch((error: unknown) => {
            logger.error(
              { err: error instanceof Error ? { name: error.name } : {} },
              'failed sign-in not recorded',
            );
          });
      }
      return;
    }
    if (ctx.path === MAGIC_LINK_PATH && typeof body?.email === 'string') {
      await securityEvents.magicLinkRequested({ ...info, email: body.email });
    } else if (ctx.path === '/passkey/verify-registration') {
      const passkey = returned as { id?: unknown } | null | undefined;
      await securityEvents.passkeyAdded({
        ...info,
        userId,
        ...(typeof passkey?.id === 'string' ? { passkeyId: passkey.id } : {}),
      });
    } else if (ctx.path === '/passkey/delete-passkey') {
      await securityEvents.passkeyRemoved({
        ...info,
        userId,
        ...(typeof body?.id === 'string' ? { passkeyId: body.id } : {}),
      });
    }
  };
}

export function createAuth({
  db,
  env,
  mailer,
  logger = consoleLogger,
  securityEvents = noopSecurityEventRecorder,
}: CreateAuthDeps) {
  const appUrl = new URL(env.APP_URL);
  const isProduction = env.NODE_ENV === 'production';

  const plugins = [
    magicLink({
      expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
      storeToken: 'hashed',
      disableSignUp: false,
      // Same path whether or not the address has an account (no enumeration), and the send is
      // not awaited so transport latency cannot reveal anything either.
      sendMagicLink: ({ email, url, metadata }) => {
        mailer
          .send({
            to: email,
            template: 'auth.magicLink',
            subjectKey: AUTH_EMAIL_KEYS.magicLink.subject,
            bodyKey: AUTH_EMAIL_KEYS.magicLink.body,
            url,
            locale: toAuthLocale(metadata?.locale),
            expiresInMinutes: MAGIC_LINK_EXPIRES_IN_SECONDS / 60,
          })
          .catch((error: unknown) => {
            logger.error(
              { err: error instanceof Error ? { name: error.name, message: error.message } : {} },
              'magic link email failed',
            );
          });
      },
    }),
    passkey({ rpID: appUrl.hostname, rpName: 'CauseDeck', origin: appUrl.origin }),
    organization({
      ac,
      roles,
      creatorRole: 'owner',
      organizationHooks: {
        beforeAddMember: ({ member }) => {
          assertKnownRoles(member.role);
          return Promise.resolve();
        },
        beforeUpdateMemberRole: ({ newRole }) => {
          assertKnownRoles(newRole);
          return Promise.resolve();
        },
        beforeCreateInvitation: ({ invitation }) => {
          assertKnownRoles(invitation.role);
          return Promise.resolve();
        },
      },
    }),
    twoFactor({ issuer: 'CauseDeck' }),
  ] satisfies BetterAuthPlugin[];

  // Literal `process.env.NODE_ENV` so production bundles drop the dev provider entirely.
  const devPlugins =
    // eslint-disable-next-line no-process-env -- must stay a literal for bundler dead-code elimination.
    process.env.NODE_ENV !== 'production' && !isProduction ? [devSignIn()] : [];

  return betterAuth({
    appName: 'CauseDeck',
    baseURL: appUrl.origin,
    secret: env.BETTER_AUTH_SECRET.reveal(),
    trustedOrigins: [appUrl.origin],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: false },
    socialProviders: env.AUTH_GOOGLE_ENABLED
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET.reveal(),
          },
        }
      : {},
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'en', input: false },
      },
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: isProduction,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        [MAGIC_LINK_PATH]: {
          window: MAGIC_LINK_IP_LIMIT.windowSeconds,
          max: MAGIC_LINK_IP_LIMIT.max,
        },
      },
    },
    logger: {
      level: isProduction ? 'warn' : 'info',
      // Only the message: Better Auth's extra args can carry request data.
      log: (level, message) => {
        logger[level]({ source: 'better-auth' }, message);
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = ctx.body as Record<string, unknown> | undefined;
        if (ctx.path === MAGIC_LINK_PATH && typeof body?.email === 'string') {
          const allowed = await consumeRateLimit(
            db,
            magicLinkEmailKey(body.email),
            MAGIC_LINK_EMAIL_LIMIT,
          );
          if (!allowed) throw new APIError('TOO_MANY_REQUESTS', { message: RATE_LIMIT_MESSAGE });
        }
      }),
      // Security events (#228); session, 2FA and revocation events come from `databaseHooks`.
      after: createAuthMiddleware((ctx) => securityEventHook(securityEvents, logger)(ctx)),
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session, ctx) => {
            await securityEvents.signInSucceeded({
              ...requestInfo(ctx),
              userId: session.userId,
              sessionId: session.id,
              method: signInMethod(ctx?.path),
            });
          },
        },
        delete: {
          // Only explicit revocations; sign-out and expiry cleanup are not security events.
          after: async (session, ctx) => {
            if (ctx?.path === undefined || !REVOKE_PATHS.has(ctx.path)) return;
            await securityEvents.sessionRevoked({
              ...requestInfo(ctx),
              userId: ctx.context.session?.user.id ?? session.userId,
              sessionId: session.id,
            });
          },
        },
      },
      user: {
        update: {
          // The two-factor plugin flips `twoFactorEnabled` only when it changes (first verify or
          // `enable` without verification, and `disable`).
          after: async (user, ctx) => {
            const path = ctx?.path;
            if (path?.startsWith('/two-factor/') !== true) return;
            const enabled = (user as { twoFactorEnabled?: unknown }).twoFactorEnabled;
            const event = { ...requestInfo(ctx), userId: user.id };
            if (path === '/two-factor/disable' && enabled === false) {
              await securityEvents.twoFactorDisabled(event);
            } else if (path !== '/two-factor/disable' && enabled === true) {
              await securityEvents.twoFactorEnabled(event);
            }
          },
        },
      },
    },
    plugins: [...plugins, ...devPlugins],
  });
}

export type Auth = ReturnType<typeof createAuth>;
