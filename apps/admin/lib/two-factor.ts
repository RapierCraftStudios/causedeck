// The admin console's per-session 2FA step (#309). Staff sign in by magic link, which Better Auth's
// twoFactor plugin does not intercept, so after sign-in the console asks for a TOTP code
// (`/verify-2fa`) and, once Better Auth accepts it, sets this cookie: an HMAC over the session id
// and the verification time, keyed with BETTER_AUTH_SECRET. It is valid only for that session and
// at most for the staff session lifetime. #304's step-up primitive may replace it later.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { STAFF_SESSION_SECONDS } from './roles.ts';

export const ADMIN_TWO_FACTOR_COOKIE = 'cd_admin_2fa';

function mac(secret: string, sessionId: string, verifiedAtMs: number): string {
  return createHmac('sha256', secret)
    .update(`admin-2fa.${sessionId}.${String(verifiedAtMs)}`)
    .digest('base64url');
}

/** Cookie value for `sessionId`, verified at `verifiedAtMs`. */
export function signTwoFactorCookie(
  secret: string,
  sessionId: string,
  verifiedAtMs: number,
): string {
  return `${String(verifiedAtMs)}.${mac(secret, sessionId, verifiedAtMs)}`;
}

/** True when `value` was signed for `sessionId` within the staff session lifetime. */
export function verifyTwoFactorCookie(
  secret: string,
  value: string | undefined,
  sessionId: string,
  nowMs: number,
): boolean {
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const stamp = value.slice(0, dot);
  if (!/^\d{1,16}$/.test(stamp)) return false;
  const verifiedAtMs = Number(stamp);
  if (verifiedAtMs > nowMs || nowMs - verifiedAtMs >= STAFF_SESSION_SECONDS * 1000) return false;
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(secret, sessionId, verifiedAtMs));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Cookie attributes: httpOnly, SameSite=Strict, Secure in production, no longer than the session. */
export function twoFactorCookieOptions(production: boolean) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: production,
    path: '/',
    maxAge: STAFF_SESSION_SECONDS,
  };
}

/** TOTP attempts per staff user. Session-bound verifies have no Better Auth lockout. */
export const STAFF_TOTP_LIMIT = { max: 5, windowSeconds: 15 * 60 } as const;

export function staffTotpRateLimitKey(userId: string): string {
  return `admin-2fa:user:${userId}`;
}

/** A six-digit TOTP code with spaces removed, or `null`. */
export function normaliseTotpCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replaceAll(/\s/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}
