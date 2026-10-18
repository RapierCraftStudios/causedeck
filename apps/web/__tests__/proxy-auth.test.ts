// Signed-out redirect in the proxy (#153): cookie presence only, CSP and locale kept.
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { isProtectedPath, proxy } from '../proxy.ts';

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

  it.each(['/w', '/w/demo/today', '/account', '/account/passkeys'])('protects %s', (path) => {
    const { url } = location(path);
    expect(url?.pathname).toBe('/sign-in');
    expect(url?.searchParams.get('next')).toBe(path);
  });

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
  ])('never redirects the public path %s', (path) => {
    const { response, url } = location(path);
    expect(url).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('matches only /w/** and /account/**', () => {
    expect(isProtectedPath('/w')).toBe(true);
    expect(isProtectedPath('/w/')).toBe(true);
    expect(isProtectedPath('/account')).toBe(true);
    expect(isProtectedPath('/wiki')).toBe(false);
    expect(isProtectedPath('/accounts')).toBe(false);
    expect(isProtectedPath('/sign-in')).toBe(false);
  });
});
