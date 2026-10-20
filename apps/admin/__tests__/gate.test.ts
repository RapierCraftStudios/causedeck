// The staff gate (#309): deny by default, one generic 404 for every reason, a TOTP redirect only
// for enrolled staff on pages, and the dev bypass only for the dev staff account outside production.
import { describe, expect, it } from 'vitest';

import {
  classifyPath,
  decide,
  type GateConfig,
  type GateDeps,
  type GateSession,
} from '../lib/gate.ts';
import { parseIpAllowlist } from '../lib/ip-allowlist.ts';
import { DEV_STAFF_EMAIL } from '../lib/roles.ts';
import { ADMIN_TWO_FACTOR_COOKIE, signTwoFactorCookie } from '../lib/two-factor.ts';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const NOW = 1_800_000_000_000;

const STAFF: GateSession = {
  session: { id: 'sess-staff' },
  user: { id: 'u-staff', email: 'ops@causedeck.test', twoFactorEnabled: true },
};
const NO_2FA: GateSession = {
  session: { id: 'sess-no2fa' },
  user: { id: 'u-no2fa', email: 'support@causedeck.test', twoFactorEnabled: false },
};
const NON_STAFF: GateSession = {
  session: { id: 'sess-user' },
  user: { id: 'u-user', email: 'lawyer@causedeck.test', twoFactorEnabled: true },
};
const DISABLED: GateSession = {
  session: { id: 'sess-disabled' },
  user: { id: 'u-disabled', email: 'gone@causedeck.test', twoFactorEnabled: true },
};
const DEV: GateSession = {
  session: { id: 'sess-dev' },
  user: { id: 'u-dev', email: DEV_STAFF_EMAIL, twoFactorEnabled: false },
};

const ACTIVE_STAFF = new Set(['u-staff', 'u-no2fa', 'u-dev']);

function deps(session: GateSession | null): GateDeps {
  return {
    getSession: () => Promise.resolve(session),
    isActiveStaff: (userId) => Promise.resolve(ACTIVE_STAFF.has(userId)),
  };
}

function config(overrides: Partial<GateConfig> = {}): GateConfig {
  return { production: true, secret: SECRET, now: () => NOW, ...overrides };
}

function request(
  pathname: string,
  init: { cookie?: string; headers?: Record<string, string> } = {},
) {
  return {
    pathname,
    headers: new Headers(init.headers),
    cookie: (name: string) => (name === ADMIN_TWO_FACTOR_COOKIE ? init.cookie : undefined),
  };
}

const verified = (session: GateSession) =>
  signTwoFactorCookie(SECRET, session.session.id, NOW - 1000);

const CONSOLE_PATHS = ['/', '/flags', '/workspaces', '/support', '/audit', '/adapters', '/nope'];

describe('classifyPath', () => {
  it('opens only the sign-in subset of /api/auth', () => {
    expect(classifyPath('/healthz', { production: true })).toBe('probe');
    expect(classifyPath('/_next/static/chunks/a.js', { production: true })).toBe('asset');
    expect(classifyPath('/sign-in', { production: true })).toBe('public');
    expect(classifyPath('/api/auth/sign-in/magic-link', { production: true })).toBe('public');
    expect(classifyPath('/api/auth/magic-link/verify', { production: true })).toBe('public');
    expect(classifyPath('/verify-2fa', { production: true })).toBe('two-factor');
    for (const path of ['/api/auth/list-sessions', '/api/auth/two-factor/enable', '/api/auth']) {
      expect(classifyPath(path, { production: true }), path).toBe('closed');
    }
    expect(classifyPath('/api/auth/dev/sign-in', { production: true })).toBe('closed');
    expect(classifyPath('/api/auth/dev/sign-in', { production: false })).toBe('public');
    expect(classifyPath('/api/anything', { production: true })).toBe('console');
  });
});

describe('decide: denials', () => {
  it.each(CONSOLE_PATHS)('denies %s without a session', async (path) => {
    expect(await decide(request(path), config(), deps(null))).toEqual({ kind: 'deny' });
  });

  it.each(CONSOLE_PATHS)('denies %s to a signed-in non-staff user', async (path) => {
    const cookie = verified(NON_STAFF);
    expect(await decide(request(path, { cookie }), config(), deps(NON_STAFF))).toEqual({
      kind: 'deny',
    });
  });

  it('denies disabled staff', async () => {
    const cookie = verified(DISABLED);
    expect(await decide(request('/', { cookie }), config(), deps(DISABLED))).toEqual({
      kind: 'deny',
    });
  });

  it('denies staff with no 2FA enrolled, even on the TOTP step', async () => {
    for (const path of ['/', '/flags', '/verify-2fa']) {
      expect(await decide(request(path), config(), deps(NO_2FA)), path).toEqual({ kind: 'deny' });
    }
  });

  it('denies a signed-in non-staff user on the sign-in page too', async () => {
    expect(await decide(request('/sign-in'), config(), deps(NON_STAFF))).toEqual({ kind: 'deny' });
  });

  it('denies closed Better Auth paths whoever asks', async () => {
    const cookie = verified(STAFF);
    expect(
      await decide(request('/api/auth/list-sessions', { cookie }), config(), deps(STAFF)),
    ).toEqual({ kind: 'deny' });
  });

  it('denies an API call from enrolled staff before the TOTP step', async () => {
    expect(await decide(request('/api/anything'), config(), deps(STAFF))).toEqual({ kind: 'deny' });
  });

  it('rejects a 2FA cookie for another session, a forged one, and an expired one', async () => {
    const other = signTwoFactorCookie(SECRET, 'another-session', NOW - 1000);
    const forged = signTwoFactorCookie('wrong-secret', STAFF.session.id, NOW - 1000);
    const expired = signTwoFactorCookie(SECRET, STAFF.session.id, NOW - 8 * 60 * 60 * 1000);
    for (const cookie of [other, forged, expired, 'garbage']) {
      expect(await decide(request('/', { cookie }), config(), deps(STAFF))).toEqual({
        kind: 'redirect',
        location: '/verify-2fa',
      });
    }
  });

  it('denies a request from outside the IP allowlist, sign-in and assets included', async () => {
    const cfg = config({ ipAllowlist: parseIpAllowlist('203.0.113.0/24, 2001:db8::/32') });
    const outside = { 'x-forwarded-for': '198.51.100.7' };
    const cookie = verified(STAFF);
    for (const path of ['/', '/sign-in', '/_next/static/x.js', '/api/auth/sign-in/magic-link']) {
      expect(
        await decide(request(path, { cookie, headers: outside }), cfg, deps(STAFF)),
        path,
      ).toEqual({ kind: 'deny' });
    }
    const inside = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
    expect(await decide(request('/', { cookie, headers: inside }), cfg, deps(STAFF))).toEqual({
      kind: 'allow',
    });
  });

  it('denies without a valid Cloudflare Access assertion when CF_ACCESS_AUD is set', async () => {
    const cfAccess = (token: string | null | undefined) => Promise.resolve(token === 'good');
    const cookie = verified(STAFF);
    expect(await decide(request('/', { cookie }), config({ cfAccess }), deps(STAFF))).toEqual({
      kind: 'deny',
    });
    expect(
      await decide(
        request('/_next/static/x.js', { headers: { 'cf-access-jwt-assertion': 'bad' } }),
        config({ cfAccess }),
        deps(null),
      ),
    ).toEqual({ kind: 'deny' });
    expect(
      await decide(
        request('/', { cookie, headers: { 'cf-access-jwt-assertion': 'good' } }),
        config({ cfAccess }),
        deps(STAFF),
      ),
    ).toEqual({ kind: 'allow' });
  });

  it('treats a failing session lookup as no session', async () => {
    const failing: GateDeps = {
      getSession: () => Promise.reject(new Error('db down')),
      isActiveStaff: () => Promise.resolve(true),
    };
    expect(await decide(request('/'), config(), failing)).toEqual({ kind: 'deny' });
  });
});

describe('decide: allowed', () => {
  it('lets enrolled staff with a valid 2FA cookie reach every console page and API', async () => {
    const cookie = verified(STAFF);
    for (const path of [...CONSOLE_PATHS, '/api/anything']) {
      expect(await decide(request(path, { cookie }), config(), deps(STAFF)), path).toEqual({
        kind: 'allow',
      });
    }
  });

  it('sends enrolled staff without the cookie to the TOTP step, which they may open', async () => {
    expect(await decide(request('/flags'), config(), deps(STAFF))).toEqual({
      kind: 'redirect',
      location: '/verify-2fa',
    });
    expect(await decide(request('/verify-2fa'), config(), deps(STAFF))).toEqual({ kind: 'allow' });
  });

  it('opens sign-in, assets and the liveness probe to anyone signed out', async () => {
    for (const path of [
      '/sign-in',
      '/api/auth/sign-in/magic-link',
      '/_next/static/x.js',
      '/healthz',
    ]) {
      expect(await decide(request(path), config(), deps(null)), path).toEqual({ kind: 'allow' });
    }
  });
});

describe('dev staff bypass', () => {
  const cfg = (production: boolean) =>
    config({ production, ipAllowlist: parseIpAllowlist('203.0.113.0/24') });
  const outside = { 'x-forwarded-for': '198.51.100.7' };

  it('skips the IP allowlist and 2FA for the dev staff account outside production', async () => {
    expect(await decide(request('/flags', { headers: outside }), cfg(false), deps(DEV))).toEqual({
      kind: 'allow',
    });
  });

  it('never applies in production', async () => {
    expect(await decide(request('/flags', { headers: outside }), cfg(true), deps(DEV))).toEqual({
      kind: 'deny',
    });
    expect(await decide(request('/flags'), config({ production: true }), deps(DEV))).toEqual({
      kind: 'deny',
    });
  });

  it('never applies to any other staff account', async () => {
    expect(await decide(request('/flags', { headers: outside }), cfg(false), deps(STAFF))).toEqual({
      kind: 'deny',
    });
    expect(await decide(request('/flags'), config({ production: false }), deps(NO_2FA))).toEqual({
      kind: 'deny',
    });
  });

  it('still needs an enabled staff_user row', async () => {
    const notStaff: GateDeps = { ...deps(DEV), isActiveStaff: () => Promise.resolve(false) };
    expect(await decide(request('/flags'), config({ production: false }), notStaff)).toEqual({
      kind: 'deny',
    });
  });
});
