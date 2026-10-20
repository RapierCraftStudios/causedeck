'use server';
// Account actions (`/account`). None of them is workspace-scoped, so they use `safeAction` instead
// of `workspaceAction`; each acts on the caller's own user only.
//
// Change the UI language from the locale switcher (#175). Not workspace-scoped and open to signed-out
// callers (the sign-in footer), so it uses `safeAction` with the optional session. The `NEXT_LOCALE`
// cookie is always written; a signed-in user's `user.locale` is updated too, since the saved setting
// wins over the cookie in i18n/request.ts. Better Auth declares `locale` as `input: false`, so its
// public `updateUser` endpoint cannot change it; the internal adapter can.
import { UnauthenticatedError } from '@causedeck/auth';
import { LOCALES, type Locale } from '@causedeck/i18n/locales';
import { APIError } from 'better-auth/api';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';

import { LOCALE_COOKIE } from '../../../i18n/routing.ts';
import { ActionError, safeAction, type ActionCtx, type Result } from '../../../lib/safe-action.ts';

const ONE_YEAR = 60 * 60 * 24 * 365;

const SetLocaleInput = z.object({ locale: z.enum(LOCALES) });

export interface SetLocaleOutcome {
  locale: Locale;
  /** The "Language updated" toast, already in the new language. */
  message: string;
}

const setLocale = safeAction(SetLocaleInput, async ({ locale }, ctx): Promise<SetLocaleOutcome> => {
  if (ctx.session) {
    const { getAuth } = await import('../../../lib/auth.ts');
    const { internalAdapter } = await getAuth().$context;
    await internalAdapter.updateUser(ctx.session.user.id, { locale });
  }
  // Same attributes as the default proxy.ts sets.
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' });
  const t = await getTranslations({ locale, namespace: 'locale' });
  return { locale, message: t('updated') };
});

// authz: public — open to signed-out callers (sign-in footer); only writes the caller's own
// locale cookie and, when signed in, their own user row.
export async function setLocaleAction(raw: unknown): Promise<Result<SetLocaleOutcome>> {
  return setLocale(raw);
}

// Account security (#289): profile name, TOTP two-factor, passkey removal and session revocation.
// Every action requires a session and only ever touches the caller's own user, passkeys and
// sessions; an id that is not the caller's is `FORBIDDEN`. Better Auth endpoints run through
// `getAuth().api` with the request headers, so its hooks write the `auth.*` audit events
// (packages/auth/src/server.ts); the name change records `account.profile_updated`. TOTP secrets
// and backup codes are returned to the caller once and never logged.

function sessionOf(ctx: ActionCtx) {
  if (!ctx.session) throw new UnauthenticatedError();
  return ctx.session;
}

async function auth() {
  const { getAuth } = await import('../../../lib/auth.ts');
  return getAuth();
}

/** Copy Better Auth's Set-Cookie headers onto the response (the session rotates on 2FA verify). */
async function forwardCookies(responseHeaders: Headers): Promise<void> {
  const setCookie = responseHeaders.get('set-cookie');
  if (!setCookie) return;
  const jar = await cookies();
  parseSetCookieHeader(setCookie).forEach((value, name) => {
    if (name) jar.set(name, value.value, toCookieOptions(value));
  });
}

const AccountProfileInput = z.object({ name: z.string().trim().min(1).max(120) });

export interface AccountProfileOutcome {
  name: string;
}

const updateAccountProfile = safeAction(
  AccountProfileInput,
  async ({ name }, ctx): Promise<AccountProfileOutcome> => {
    const session = sessionOf(ctx);
    if (name === session.user.name) return { name };
    const { internalAdapter } = await (await auth()).$context;
    await internalAdapter.updateUser(session.user.id, { name });
    const { recordAccountProfileUpdatedFor } = await import('@causedeck/core/runtime');
    const userAgent = (await headers()).get('user-agent') ?? undefined;
    await recordAccountProfileUpdatedFor(session.user.id, ['name'], {
      requestId: ctx.requestId,
      ...(userAgent === undefined ? {} : { userAgent }),
    });
    return { name };
  },
);

// authz: public — self only: requires a session and renames the caller's own user row.
export async function updateAccountProfileAction(
  raw: unknown,
): Promise<Result<AccountProfileOutcome>> {
  return updateAccountProfile(raw);
}

export interface TwoFactorSetup {
  /** The `otpauth://` URI as an SVG QR code (`data:` URL), quiet zone included. */
  qr: string;
  /** The base32 secret, for typing into an app that cannot scan. */
  secret: string;
  /** One-time backup codes, shown once. */
  backupCodes: string[];
}

const enableTwoFactor = safeAction(z.object({}), async (_input, ctx): Promise<TwoFactorSetup> => {
  sessionOf(ctx);
  const api = (await auth()).api;
  const requestHeaders = await headers();
  // Enabling again would replace the secret the caller's authenticator app already uses.
  const current = await api.getSession({ headers: requestHeaders });
  if ((current?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled) {
    throw new ActionError('CONFLICT', 'Two-factor authentication is already on.');
  }
  const enabled = await api.enableTwoFactor({ body: {}, headers: requestHeaders });
  // TOTP is the default method; the `otp` branch (codes by email) is not configured.
  if (!('totpURI' in enabled)) throw new Error('two-factor enable returned no TOTP URI');
  const { totpURI, backupCodes } = enabled;
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  const { renderSVG } = await import('uqr');
  // Black on white with a 4-module quiet zone, whatever the theme.
  const svg = renderSVG(totpURI, { border: 4, whiteColor: '#ffffff', blackColor: '#000000' });
  return {
    qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    secret,
    backupCodes,
  };
});

// authz: public — self only: starts TOTP setup for the signed-in caller's own account.
export async function enableTwoFactorAction(raw: unknown): Promise<Result<TwoFactorSetup>> {
  return enableTwoFactor(raw);
}

const VerifyTwoFactorInput = z.object({ code: z.string().regex(/^\d{6}$/) });

const verifyTwoFactor = safeAction(
  VerifyTwoFactorInput,
  async ({ code }, ctx): Promise<{ enabled: true }> => {
    sessionOf(ctx);
    try {
      const { headers: responseHeaders } = await (
        await auth()
      ).api.verifyTOTP({ body: { code }, headers: await headers(), returnHeaders: true });
      await forwardCookies(responseHeaders);
    } catch (error) {
      if (error instanceof APIError) {
        throw new ActionError('VALIDATION', 'That code did not work.', { code: ['wrongCode'] });
      }
      throw error;
    }
    return { enabled: true };
  },
);

// authz: public — self only: verifies the caller's own pending TOTP secret.
export async function verifyTwoFactorAction(raw: unknown): Promise<Result<{ enabled: true }>> {
  return verifyTwoFactor(raw);
}

const DeletePasskeyInput = z.object({ id: z.string().min(1).max(200) });

const deletePasskey = safeAction(
  DeletePasskeyInput,
  async ({ id }, ctx): Promise<{ id: string }> => {
    sessionOf(ctx);
    const api = (await auth()).api;
    const requestHeaders = await headers();
    const passkeys = await api.listPasskeys({ headers: requestHeaders });
    if (!passkeys.some((passkey) => passkey.id === id)) {
      throw new ActionError('FORBIDDEN', 'You can only manage your own account.');
    }
    await api.deletePasskey({ body: { id }, headers: requestHeaders });
    return { id };
  },
);

// authz: public — self only: removes a passkey only after finding it among the caller's own.
export async function deletePasskeyAction(raw: unknown): Promise<Result<{ id: string }>> {
  return deletePasskey(raw);
}

const RevokeSessionInput = z.object({ sessionId: z.string().min(1).max(200) });

const revokeSession = safeAction(
  RevokeSessionInput,
  async ({ sessionId }, ctx): Promise<{ sessionId: string }> => {
    const session = sessionOf(ctx);
    // The current session signs out instead; revoking it here would strand the page.
    if (sessionId === (session.session as { id?: unknown }).id) {
      throw new ActionError('FORBIDDEN', 'You can only revoke your other sessions.');
    }
    const api = (await auth()).api;
    const requestHeaders = await headers();
    const sessions = await api.listSessions({ headers: requestHeaders });
    const target = sessions.find((candidate) => candidate.id === sessionId);
    if (!target) throw new ActionError('FORBIDDEN', 'You can only manage your own account.');
    // The token stays on the server; the client only ever sees session ids.
    await api.revokeSession({ body: { token: target.token }, headers: requestHeaders });
    return { sessionId };
  },
);

// authz: public — self only: revokes one of the caller's own other sessions, found by id.
export async function revokeSessionAction(raw: unknown): Promise<Result<{ sessionId: string }>> {
  return revokeSession(raw);
}
