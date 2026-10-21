// Admin response headers (#309): noindex, no-store and a CSP that forbids framing, on allowed
// responses and on the generic 404 alike; every denial is byte-identical.
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_SECURITY_HEADERS } from '../lib/csp.ts';
import { NOT_FOUND_BODY } from '../lib/not-found-response.ts';
import { signTwoFactorCookie, ADMIN_TWO_FACTOR_COOKIE } from '../lib/two-factor.ts';

const session = vi.hoisted(() => ({
  current: null as null | {
    session: { id: string };
    user: { id: string; email: string; twoFactorEnabled: boolean };
  },
  staff: new Set<string>(),
}));

vi.mock('../lib/auth.ts', () => ({
  sessionFor: () => Promise.resolve(session.current),
  getAuth: () => {
    throw new Error('not used');
  },
}));
vi.mock('@causedeck/core/support', () => ({
  isActiveStaff: (_db: unknown, userId: string) => Promise.resolve(session.staff.has(userId)),
}));

const { proxy } = await import('../proxy.ts');
const { default: nextConfig } = await import('../next.config.ts');
const { serverEnv } = await import('../lib/env.ts');

const BASE = 'http://localhost:3200';

function expectAdminHeaders(response: Response) {
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-frame-options')).toBe('DENY');
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
}

beforeEach(() => {
  session.current = null;
  session.staff.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('generic 404', () => {
  it('is identical for an unknown path, a console page, an API and a closed auth path', async () => {
    const paths = [
      '/',
      '/flags',
      '/workspaces',
      '/does-not-exist',
      '/api/anything',
      '/api/auth/list-sessions',
    ];
    const responses = await Promise.all(paths.map((p) => proxy(new NextRequest(`${BASE}${p}`))));
    const bodies = await Promise.all(responses.map((r) => r.text()));
    for (const [i, response] of responses.entries()) {
      expect(response.status, paths[i]).toBe(404);
      expectAdminHeaders(response);
      expect(bodies[i]).toBe(NOT_FOUND_BODY);
      expect([...response.headers.entries()]).toEqual([...(responses[0]?.headers.entries() ?? [])]);
    }
  });

  it('is what a signed-in non-staff user and staff without 2FA get too', async () => {
    session.current = {
      session: { id: 's1' },
      user: { id: 'u1', email: 'lawyer@causedeck.test', twoFactorEnabled: true },
    };
    const nonStaff = await proxy(new NextRequest(`${BASE}/flags`));
    session.staff.add('u2');
    session.current = {
      session: { id: 's2' },
      user: { id: 'u2', email: 'support@causedeck.test', twoFactorEnabled: false },
    };
    const no2fa = await proxy(new NextRequest(`${BASE}/flags`));
    for (const response of [nonStaff, no2fa]) {
      expect(response.status).toBe(404);
      expectAdminHeaders(response);
      expect(await response.text()).toBe(NOT_FOUND_BODY);
    }
  });
});

describe('allowed responses', () => {
  it('carry the admin headers and a per-request nonce CSP', async () => {
    session.staff.add('u3');
    session.current = {
      session: { id: 's3' },
      user: { id: 'u3', email: 'ops@causedeck.test', twoFactorEnabled: true },
    };
    const secret = serverEnv().BETTER_AUTH_SECRET.reveal();
    const request = new NextRequest(`${BASE}/flags`);
    request.cookies.set(ADMIN_TWO_FACTOR_COOKIE, signTwoFactorCookie(secret, 's3', Date.now()));
    const response = await proxy(request);
    expect(response.status).toBe(200);
    expectAdminHeaders(response);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('redirects enrolled staff without the 2FA cookie to the TOTP step, with the headers', async () => {
    session.staff.add('u4');
    session.current = {
      session: { id: 's4' },
      user: { id: 'u4', email: 'admin@causedeck.test', twoFactorEnabled: true },
    };
    const response = await proxy(new NextRequest(`${BASE}/flags`));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${BASE}/verify-2fa`);
    expectAdminHeaders(response);
  });

  it('let signed-out visitors open the sign-in page', async () => {
    const response = await proxy(new NextRequest(`${BASE}/sign-in`));
    expect(response.status).toBe(200);
    expectAdminHeaders(response);
  });
});

describe('next.config headers', () => {
  it('send noindex, no-store and DENY framing on every path', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules).toEqual([{ source: '/:path*', headers: [...ADMIN_SECURITY_HEADERS] }]);
    const byKey = Object.fromEntries(ADMIN_SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(byKey['Cache-Control']).toBe('no-store');
    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(nextConfig.output).toBe('standalone');
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
