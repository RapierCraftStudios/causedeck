// Signed-out redirect in the proxy (#153): cookie presence only, CSP and locale kept.
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { isProtectedPath, proxy, workspaceSlugOf } from '../proxy.ts';

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { headers });

const SESSION_COOKIE = 'better-auth.session_token=token.signature';
const SECURE_SESSION_COOKIE = '__Secure-better-auth.session_token=token.signature';

function location(path: string, headers?: Record<string, string>) {
  const response = proxy(request(path, headers));
  const header = response.headers.get('location');
  return { response, url: header === null ? null : new URL(header) };
}

describe('proxy auth redirect', () => {
  it('sends a signed-out /w/anything to /sign-in?next=/w/anything', () => {
    const { response, url } = location('/w/anything');
    expect(response.status).toBe(307);
    expect(url?.origin).toBe('http://localhost:3000');
    expect(url?.pathname).toBe('/sign-in');
    expect(url?.searchParams.get('next')).toBe('/w/anything');
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/sign-in?next=%2Fw%2Fanything',
    );
  });

  it.each(['/w', '/w/demo/today', '/account', '/account/passkeys', '/onboarding'])(
    'protects %s',
    (path) => {
      const { url } = location(path);
      expect(url?.pathname).toBe('/sign-in');
      expect(url?.searchParams.get('next')).toBe(path);
    },
  );

  it('keeps the query string in next', () => {
    const { url } = location('/w/demo/matters?stage=filed');
    expect(url?.searchParams.get('next')).toBe('/w/demo/matters?stage=filed');
  });

  it('still sends the CSP header and the default locale cookie on the redirect', () => {
    const { response } = location('/w/anything', { 'accept-language': 'kn' });
    expect(response.headers.get('content-security-policy')).toMatch(/'nonce-[^']+'/);
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('kn');
  });

  it.each([SESSION_COOKIE, SECURE_SESSION_COOKIE])(
    'lets a request with a session cookie through (%s)',
    (cookie) => {
      const { response, url } = location('/w/anything', { cookie });
      expect(url).toBeNull();
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(response.headers.get('x-middleware-request-x-pathname')).toBe('/w/anything');
    },
  );

  it.each([
    '/',
    '/sign-in',
    '/sign-in?next=%2Fw%2Fx',
    '/offline',
    '/invite/abc',
    '/api/auth/ok',
    '/wiki',
    '/accounts',
    '/onboardings',
  ])('never redirects the public path %s', (path) => {
    const { response, url } = location(path);
    expect(url).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('matches only /w/**, /account/** and /onboarding', () => {
    expect(isProtectedPath('/w')).toBe(true);
    expect(isProtectedPath('/w/')).toBe(true);
    expect(isProtectedPath('/account')).toBe(true);
    expect(isProtectedPath('/onboarding')).toBe(true);
    expect(isProtectedPath('/onboardings')).toBe(false);
    expect(isProtectedPath('/wiki')).toBe(false);
    expect(isProtectedPath('/accounts')).toBe(false);
    expect(isProtectedPath('/sign-in')).toBe(false);
  });
});

describe('proxy last-workspace cookie and bare /w (#179)', () => {
  it('remembers the workspace slug of a signed-in /w/<slug> request in cd_last_ws', () => {
    const { response } = location('/w/Chennai-Solo/matters', { cookie: SESSION_COOKIE });
    const cookie = response.cookies.get('cd_last_ws');
    expect(cookie?.value).toBe('chennai-solo');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
  });

  it('does not rewrite the cookie when it already names the workspace', () => {
    const { response } = location('/w/demo/today', {
      cookie: `${SESSION_COOKIE}; cd_last_ws=demo`,
    });
    expect(response.cookies.get('cd_last_ws')).toBeUndefined();
  });

  it('never sets it on signed-out redirects or outside /w', () => {
    expect(location('/w/demo/today').response.cookies.get('cd_last_ws')).toBeUndefined();
    const account = location('/account', { cookie: SESSION_COOKIE }).response;
    expect(account.cookies.get('cd_last_ws')).toBeUndefined();
  });

  it.each(['/w', '/w/'])('sends a signed-in bare %s to / (which picks the workspace)', (path) => {
    const { url } = location(path, { cookie: SESSION_COOKIE });
    expect(url?.pathname).toBe('/');
  });

  it('extracts only slug-shaped workspace segments', () => {
    expect(workspaceSlugOf('/w/demo')).toBe('demo');
    expect(workspaceSlugOf('/w/demo/today')).toBe('demo');
    expect(workspaceSlugOf('/w/bad_slug/today')).toBeNull();
    expect(workspaceSlugOf('/w/')).toBeNull();
    expect(workspaceSlugOf(`/w/${'a'.repeat(49)}`)).toBeNull();
    expect(workspaceSlugOf('/wiki/demo')).toBeNull();
  });
});
