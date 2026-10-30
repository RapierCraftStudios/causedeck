// Better Auth server (#152, spike §1/§6, ADR 0004): magic link, passkeys, Google behind a switch,
// organizations as workspaces with the `roles.ts` roles, TOTP 2FA, cookie sessions and database
// rate limiting. Server-only: import from `@causedeck/auth/server`. See docs/engineering/auth.md.
import type { Secret, ServerEnv } from '@causedeck/config/env';
import type { Database } from '@causedeck/db';
import { schema } from '@causedeck/db';
import { eq } from 'drizzle-orm';
import { passkey } from '@better-auth/passkey';
import { sso } from '@better-auth/sso';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { magicLink, organization, phoneNumber, twoFactor } from 'better-auth/plugins';

import { DEMO_SIGN_IN_LIMIT, DEMO_SIGN_IN_PATH, demoSignIn, type DemoEntry } from './demo-provider';
import { DEV_SIGN_IN_PATH, devSignIn } from './dev-provider';
import { consoleLogger, type AuthLogger, type Mailer } from './mailer';
import { AUTH_EMAIL_KEYS, toAuthLocale } from './messages';
import {
  consumeRateLimit,
  MAGIC_LINK_EMAIL_LIMIT,
  MAGIC_LINK_IP_LIMIT,
  magicLinkEmailKey,
  PHONE_OTP_IP_LIMIT,
  PHONE_OTP_PHONE_LIMIT,
  PHONE_VERIFY_IP_LIMIT,
  phoneOtpKey,
  RATE_LIMIT_MESSAGE,
  SSO_DOMAIN_LIMIT,
  SSO_IP_LIMIT,
  ssoDomainKey,
} from './rate-limit';
import { ac, isRole, roles } from './roles';
import {
  isBlockedSsoPath,
  isSsoPath,
  isSsoReturnPath,
  provisionSsoMember,
  ssoDomainOf,
  ssoEmailAllowed,
  withSsoProviderLookup,
} from './sso';
import { type SmsSender } from './sms';
import { markStepUp } from './step-up';

export const MAGIC_LINK_PATH = '/sign-in/magic-link';
export const MAGIC_LINK_EXPIRES_IN_SECONDS = 10 * 60;
export const PHONE_OTP_SEND_PATH = '/phone-number/send-otp';
export const PHONE_OTP_VERIFY_PATH = '/phone-number/verify';
export const PHONE_OTP_LENGTH = 6;
export const PHONE_OTP_EXPIRES_IN_SECONDS = 5 * 60;
export const PHONE_OTP_ALLOWED_ATTEMPTS = 3;
/** Lifetime of the email-verification link sent when a phone account adds an email. */
export const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60;
/** Phone-only accounts get this placeholder address (`user.email` is required and unique). */
export const PHONE_TEMP_EMAIL_DOMAIN = 'phone.causedeck.invalid';
const E164 = /^\+[1-9]\d{7,14}$/;
export const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

type GoogleEnv =
  | { AUTH_GOOGLE_ENABLED: false }
  | { AUTH_GOOGLE_ENABLED: true; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: Secret };

/** The env keys auth reads. Secrets arrive only as #4 `Secret` values. */
export type AuthEnv = Pick<ServerEnv, 'NODE_ENV' | 'APP_URL' | 'BETTER_AUTH_SECRET'> & GoogleEnv;

export type SignInMethod =
  'magic_link' | 'phone_otp' | 'passkey' | 'google' | 'sso' | 'two_factor' | 'dev' | 'unknown';

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
  /**
   * The handle Better Auth's own adapter reads and writes sessions, users and accounts through
   * (#805). Pass the small dedicated pool (`authDb`) so `getSession` is not queued behind a page-load
   * burst on `db`; defaults to `db`. Everything else (security events, SSO, rate limits) uses `db`.
   */
  sessionDb?: Database;
  env: AuthEnv;
  mailer: Mailer;
  /** Delivers phone sign-in OTPs. Without it the phone sign-in endpoints are not mounted. */
  sms?: SmsSender;
  logger?: AuthLogger;
  /** Defaults to `noopSecurityEventRecorder`. */
  securityEvents?: SecurityEventRecorder;
  /**
   * Session lifetime; defaults to `SESSION_EXPIRES_IN_SECONDS` (30 days). The admin console passes
   * 8 hours (#309). The refresh age shrinks with it, so a short session never slides to 30 days.
   */
  sessionExpiresInSeconds?: number;
  /** When true, magic-link sign-in never creates a user (the admin console, #309). */
  disableSignUp?: boolean;
  /** Mounts `POST /demo/sign-in` (#93): a session for an ephemeral demo-workspace visitor. */
  demo?: DemoEntry;
}

/** Refresh age for a session lifetime: a day, or a quarter of a shorter lifetime. */
export function sessionUpdateAgeFor(expiresInSeconds: number): number {
  return Math.min(SESSION_UPDATE_AGE_SECONDS, Math.floor(expiresInSeconds / 4));
}

const MAGIC_LINK_VERIFY_PATH = '/magic-link/verify';
export const SSO_SIGN_IN_PATH = '/sign-in/sso';
const SSO_CALLBACK_RULE = { window: SSO_IP_LIMIT.windowSeconds, max: SSO_IP_LIMIT.max };
const PHONE_VERIFY_PATH = PHONE_OTP_VERIFY_PATH;
const PASSKEY_SIGN_IN_PATH = '/passkey/verify-authentication';
const TWO_FACTOR_VERIFY_PATHS: ReadonlySet<string> = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-otp',
  '/two-factor/verify-backup-code',
]);
/** The ceremonies that count as step-up (#304): a passkey or a TOTP code, nothing else. */
const STEP_UP_PATHS: ReadonlySet<string> = new Set([
  PASSKEY_SIGN_IN_PATH,
  '/two-factor/verify-totp',
]);
const REVOKE_PATHS: ReadonlySet<string> = new Set([
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
]);

/** The sign-in method behind the request that created a session. */
export function signInMethod(path: string | undefined): SignInMethod {
  if (path === MAGIC_LINK_VERIFY_PATH) return 'magic_link';
  if (path === PHONE_VERIFY_PATH) return 'phone_otp';
  if (path === PASSKEY_SIGN_IN_PATH) return 'passkey';
  if (path !== undefined && isSsoPath(path)) return 'sso';
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
        ctx.path === PHONE_VERIFY_PATH ||
        ctx.path === PASSKEY_SIGN_IN_PATH ||
        TWO_FACTOR_VERIFY_PATHS.has(ctx.path) ||
        (isSsoPath(ctx.path) && ctx.path !== SSO_SIGN_IN_PATH)
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

/** The `hooks.after` view of a request that `stepUpHook` reads. */
export interface StepUpHookContext {
  path: string;
  context: {
    returned?: unknown;
    session?: { session: { id: string } } | null;
    newSession?: unknown;
  };
}

/**
 * Step-up for a signed-in user (#304): a successful `/two-factor/verify-totp` on an existing
 * session that did not create a new one stamps that session. Sessions created by a passkey or TOTP
 * ceremony are stamped on creation instead (`databaseHooks.session.create.before`).
 */
export function stepUpHook(db: Database) {
  return async (ctx: StepUpHookContext): Promise<void> => {
    if (ctx.path !== '/two-factor/verify-totp' || failed(ctx.context.returned)) return;
    const current = ctx.context.session?.session.id;
    if (current === undefined || ctx.context.newSession) return;
    await markStepUp(db, current, new Date());
  };
}

/** True for the placeholder address of a phone-only account. */
export function isPhoneTempEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${PHONE_TEMP_EMAIL_DOMAIN}`);
}

/**
 * Phone OTP sign-in (#503). The code is generated, stored hashed-by-expiry and checked by the
 * plugin (3 attempts, 5 minutes); we add the SMS delivery, an E.164 check and sign-up on first
 * verification (never when sign-up is disabled, as in the admin console). The send is not awaited,
 * so transport latency does not reveal whether the number has an account.
 */
function phoneOtpPlugin(sms: SmsSender, logger: AuthLogger, disableSignUp: boolean) {
  return phoneNumber({
    otpLength: PHONE_OTP_LENGTH,
    expiresIn: PHONE_OTP_EXPIRES_IN_SECONDS,
    allowedAttempts: PHONE_OTP_ALLOWED_ATTEMPTS,
    phoneNumberValidator: (value) => E164.test(value),
    sendOTP: ({ phoneNumber: to, code }) => {
      sms
        .send({ phoneNumber: to, code, expiresInMinutes: PHONE_OTP_EXPIRES_IN_SECONDS / 60 })
        .catch((error: unknown) => {
          logger.error(
            { err: error instanceof Error ? { name: error.name, message: error.message } : {} },
            'phone otp sms failed',
          );
        });
    },
    ...(disableSignUp
      ? {}
      : {
          signUpOnVerification: {
            getTempEmail: (value: string) => `${value.slice(1)}@${PHONE_TEMP_EMAIL_DOMAIN}`,
            getTempName: (value: string) => `***${value.slice(-4)}`,
          },
        }),
  });
}

export function createAuth({
  db,
  sessionDb = db,
  env,
  mailer,
  sms,
  logger = consoleLogger,
  securityEvents = noopSecurityEventRecorder,
  sessionExpiresInSeconds = SESSION_EXPIRES_IN_SECONDS,
  disableSignUp = false,
  demo,
}: CreateAuthDeps) {
  const appUrl = new URL(env.APP_URL);
  const isProduction = env.NODE_ENV === 'production';

  const plugins = [
    magicLink({
      expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
      storeToken: 'hashed',
      disableSignUp,
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
    ...(sms ? [phoneOtpPlugin(sms, logger, disableSignUp)] : []),
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
    // Accounts have no password (magic link, passkeys, Google), so enabling and disabling 2FA rely on
    // the session alone (#289); a user who somehow has a credential password is still asked for it.
    twoFactor({ issuer: 'CauseDeck', allowPasswordless: true }),
    // Per-organisation SAML and OIDC (#683). The plugin only reads the enabled providers of the
    // keyed `app_sso_provider_lookup` function; the owner-only core service edits them, so its own provider
    // endpoints are refused in `hooks.before`. Membership is ours (`provisionSsoMember`), not the
    // plugin's organisation provisioning, because `member` is under row-level security.
    sso({
      // The plugin refuses a sign-in on a provider whose domain is not verified, and links an
      // existing account only when the asserted email is at the verified domain. Verification
      // itself is ours (DNS TXT, owner-only core service); the plugin's endpoints are blocked.
      domainVerification: { enabled: true },
      organizationProvisioning: { disabled: true },
      provisionUserOnEveryLogin: true,
      provisionUser: async ({ user, provider }) => {
        const organizationId = (provider as { organizationId?: unknown }).organizationId;
        if (typeof organizationId === 'string') {
          await provisionSsoMember(db, organizationId, user.id);
        }
      },
    }),
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
    database: withSsoProviderLookup(
      sessionDb,
      env.BETTER_AUTH_SECRET.reveal(),
      drizzleAdapter(sessionDb, { provider: 'pg', schema }),
    ),
    emailAndPassword: { enabled: false },
    socialProviders: env.AUTH_GOOGLE_ENABLED
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET.reveal(),
          },
        }
      : {},
    account: {
      // A phone account links Google later (`linkSocial` while signed in); Google verifies emails.
      accountLinking: { enabled: true, trustedProviders: ['google'] },
    },
    emailVerification: {
      expiresIn: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
      // Only reached when a signed-in phone account adds an email (`/change-email` below): the
      // account's email changes (and is verified) only when the link is opened. It reuses the magic-link template, a link with an expiry.
      sendVerificationEmail: ({ user, url }) => {
        mailer
          .send({
            to: user.email,
            template: 'auth.magicLink',
            subjectKey: AUTH_EMAIL_KEYS.magicLink.subject,
            bodyKey: AUTH_EMAIL_KEYS.magicLink.body,
            url,
            locale: toAuthLocale((user as { locale?: unknown }).locale),
            expiresInMinutes: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS / 60,
          })
          .catch((error: unknown) => {
            logger.error(
              { err: error instanceof Error ? { name: error.name, message: error.message } : {} },
              'email verification email failed',
            );
          });
        return Promise.resolve();
      },
    },
    user: {
      // No `updateEmailWithoutVerification`: the address changes only when its owner opens the link.
      changeEmail: { enabled: true },
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'en', input: false },
      },
    },
    session: {
      // The last passkey or TOTP verification in this session (#304, `step-up.ts`).
      additionalFields: {
        stepUpAt: { type: 'date', required: false, input: false },
      },
      expiresIn: sessionExpiresInSeconds,
      updateAge: sessionUpdateAgeFor(sessionExpiresInSeconds),
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
        ...(demo
          ? {
              [DEMO_SIGN_IN_PATH]: {
                window: DEMO_SIGN_IN_LIMIT.windowSeconds,
                max: DEMO_SIGN_IN_LIMIT.max,
              },
            }
          : {}),
        [MAGIC_LINK_PATH]: {
          window: MAGIC_LINK_IP_LIMIT.windowSeconds,
          max: MAGIC_LINK_IP_LIMIT.max,
        },
        [SSO_SIGN_IN_PATH]: { window: SSO_IP_LIMIT.windowSeconds, max: SSO_IP_LIMIT.max },
        '/sso/callback/*': SSO_CALLBACK_RULE,
        '/sso/saml2/sp/acs/*': SSO_CALLBACK_RULE,
        [PHONE_OTP_SEND_PATH]: {
          window: PHONE_OTP_IP_LIMIT.windowSeconds,
          max: PHONE_OTP_IP_LIMIT.max,
        },
        [PHONE_OTP_VERIFY_PATH]: {
          window: PHONE_VERIFY_IP_LIMIT.windowSeconds,
          max: PHONE_VERIFY_IP_LIMIT.max,
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
        if (isBlockedSsoPath(ctx.path)) throw new APIError('NOT_FOUND', { message: 'Not found' });
        const body = ctx.body as Record<string, unknown> | undefined;
        if (ctx.path === MAGIC_LINK_PATH && typeof body?.email === 'string') {
          const allowed = await consumeRateLimit(
            db,
            magicLinkEmailKey(body.email),
            MAGIC_LINK_EMAIL_LIMIT,
          );
          if (!allowed) throw new APIError('TOO_MANY_REQUESTS', { message: RATE_LIMIT_MESSAGE });
        }
        if (ctx.path === SSO_SIGN_IN_PATH) {
          // Only the email domain picks a provider: a provider or organisation id would let a
          // caller probe which organisations use SSO.
          if (body?.providerId !== undefined || body?.organizationSlug !== undefined) {
            throw new APIError('BAD_REQUEST', { message: 'Sign in with your work email' });
          }
          const domain = ssoDomainOf(
            typeof body?.email === 'string'
              ? body.email
              : typeof body?.domain === 'string'
                ? body.domain
                : '',
          );
          if (domain === null) {
            throw new APIError('BAD_REQUEST', { message: 'Sign in with your work email' });
          }
          if (!(await consumeRateLimit(db, ssoDomainKey(domain), SSO_DOMAIN_LIMIT))) {
            throw new APIError('TOO_MANY_REQUESTS', { message: RATE_LIMIT_MESSAGE });
          }
        }
        if (ctx.path === PHONE_OTP_SEND_PATH && typeof body?.phoneNumber === 'string') {
          const allowed = await consumeRateLimit(
            db,
            phoneOtpKey(body.phoneNumber),
            PHONE_OTP_PHONE_LIMIT,
          );
          if (!allowed) throw new APIError('TOO_MANY_REQUESTS', { message: RATE_LIMIT_MESSAGE });
        }
        // Changing the address is only for phone-only accounts adding their first email; email
        // accounts keep today's behaviour (no self-service change).
        if (ctx.path === '/change-email') {
          const session = await getSessionFromCtx(ctx);
          if (session && !isPhoneTempEmail(session.user.email)) {
            throw new APIError('FORBIDDEN', { message: 'Email change is not available' });
          }
        }
      }),
      // Security events (#228); session, 2FA and revocation events come from `databaseHooks`.
      // Then the step-up stamp for a signed-in TOTP re-verification (#304).
      after: createAuthMiddleware(async (ctx) => {
        await securityEventHook(securityEvents, logger)(ctx);
        await stepUpHook(db)(ctx);
      }),
    },
    databaseHooks: {
      // Takeover guard (#683): on an SSO return the user or linked account must sit at the
      // provider's verified email domain, whatever the plugin decided about linking.
      account: {
        create: {
          before: async (account, ctx) => {
            if (isSsoReturnPath(ctx?.path)) {
              const providerId = (ctx?.params as { providerId?: string } | undefined)?.providerId;
              const [owner] = await db
                .select({ email: schema.user.email })
                .from(schema.user)
                .where(eq(schema.user.id, account.userId));
              if (owner === undefined || !(await ssoEmailAllowed(db, providerId, owner.email))) {
                throw new APIError('FORBIDDEN', { message: 'Email is outside the SSO domain' });
              }
            }
            return undefined;
          },
        },
      },
      session: {
        create: {
          // A session created by a passkey or TOTP ceremony starts with a fresh step-up (#304).
          before: (session, ctx) =>
            Promise.resolve(
              ctx?.path !== undefined && STEP_UP_PATHS.has(ctx.path)
                ? { data: { ...session, stepUpAt: new Date() } }
                : undefined,
            ),
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
        create: {
          before: async (user, ctx) => {
            if (isSsoReturnPath(ctx?.path)) {
              const providerId = (ctx?.params as { providerId?: string } | undefined)?.providerId;
              if (!(await ssoEmailAllowed(db, providerId, user.email))) {
                throw new APIError('FORBIDDEN', { message: 'Email is outside the SSO domain' });
              }
            }
            return undefined;
          },
          // The funnel's first step and cohort anchor (#509): the user id only, never the email.
          // Measurement must not fail a sign-up.
          after: async (user) => {
            try {
              await db
                .insert(schema.activationEvent)
                .values({ userId: user.id, step: 'signed_up' })
                .onConflictDoNothing();
            } catch (error) {
              logger.warn(
                { err: error instanceof Error ? { name: error.name } : {} },
                'signed_up activation event not recorded',
              );
            }
          },
        },
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
    plugins: [...plugins, ...devPlugins, ...(demo ? [demoSignIn(demo)] : [])],
  });
}

export type Auth = ReturnType<typeof createAuth>;
