// Better Auth server (#152, spike §1/§6, ADR 0004): magic link, passkeys, Google behind a switch,
// organizations as workspaces with the `roles.ts` roles, TOTP 2FA, cookie sessions and database
// rate limiting. Server-only: import from `@causedeck/auth/server`. See docs/engineering/auth.md.
import type { Secret, ServerEnv } from '@causedeck/config/env';
import type { Database } from '@causedeck/db';
import { schema } from '@causedeck/db';
import { passkey } from '@better-auth/passkey';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { magicLink, organization, twoFactor } from 'better-auth/plugins';

import { devSignIn } from './dev-provider';
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

export interface CreateAuthDeps {
  db: Database;
  env: AuthEnv;
  mailer: Mailer;
  logger?: AuthLogger;
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

export function createAuth({ db, env, mailer, logger = consoleLogger }: CreateAuthDeps) {
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
    },
    plugins: [...plugins, ...devPlugins],
  });
}

export type Auth = ReturnType<typeof createAuth>;
