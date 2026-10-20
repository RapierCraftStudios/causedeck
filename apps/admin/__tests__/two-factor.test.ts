import { describe, expect, it } from 'vitest';

import { STAFF_SESSION_SECONDS } from '../lib/roles.ts';
import {
  normaliseTotpCode,
  signTwoFactorCookie,
  twoFactorCookieOptions,
  verifyTwoFactorCookie,
} from '../lib/two-factor.ts';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const NOW = 1_800_000_000_000;

describe('admin 2FA cookie', () => {
  it('verifies for its own session within the staff session lifetime', () => {
    const value = signTwoFactorCookie(SECRET, 'sess-1', NOW);
    expect(verifyTwoFactorCookie(SECRET, value, 'sess-1', NOW + 60_000)).toBe(true);
  });

  it('rejects another session, another secret, tampering, the future and expiry', () => {
    const value = signTwoFactorCookie(SECRET, 'sess-1', NOW);
    expect(verifyTwoFactorCookie(SECRET, value, 'sess-2', NOW)).toBe(false);
    expect(verifyTwoFactorCookie('other-secret', value, 'sess-1', NOW)).toBe(false);
    expect(
      verifyTwoFactorCookie(SECRET, `${String(NOW + 1)}${value.slice(13)}`, 'sess-1', NOW + 2),
    ).toBe(false);
    expect(verifyTwoFactorCookie(SECRET, value, 'sess-1', NOW - 1)).toBe(false);
    expect(verifyTwoFactorCookie(SECRET, value, 'sess-1', NOW + STAFF_SESSION_SECONDS * 1000)).toBe(
      false,
    );
    for (const bad of [undefined, '', 'x', '.abc', 'abc.def']) {
      expect(verifyTwoFactorCookie(SECRET, bad, 'sess-1', NOW), String(bad)).toBe(false);
    }
  });

  it('is httpOnly, SameSite=Strict, Secure in production and no longer than the session', () => {
    expect(twoFactorCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      path: '/',
      maxAge: STAFF_SESSION_SECONDS,
    });
    expect(twoFactorCookieOptions(false).secure).toBe(false);
  });
});

describe('normaliseTotpCode', () => {
  it('accepts six digits, spaces removed, and nothing else', () => {
    expect(normaliseTotpCode('123 456')).toBe('123456');
    expect(normaliseTotpCode('12345')).toBeNull();
    expect(normaliseTotpCode('abcdef')).toBeNull();
    expect(normaliseTotpCode(null)).toBeNull();
  });
});
