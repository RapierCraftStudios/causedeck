import { describe, expect, it } from 'vitest';

import {
  isOfflineShellNavigation,
  isStaticAsset,
  isTenantRequest,
  parseOfflineRoute,
} from '../../lib/pwa/cache-policy.ts';

const tenant = (path: string, headers: Record<string, string> = {}) => {
  const url = new URL(path, 'https://app.example.test');
  return isTenantRequest(new Request(url, { headers }), url);
};

describe('service worker cache policy (#50)', () => {
  it.each([
    '/api/captures/presign',
    '/api/auth/get-session',
    '/w/acme/matters',
    '/w/acme/inbox',
    '/account',
    '/account/security',
    '/onboarding',
    '/share-target',
    '/anything?_rsc=abc',
  ])('never caches %s (tenant data or signed-in route)', (path) => {
    expect(tenant(path)).toBe(true);
  });

  it('never caches server actions, RSC payloads or authorised requests', () => {
    expect(tenant('/sign-in', { 'next-action': 'abc' })).toBe(true);
    expect(tenant('/sign-in', { rsc: '1' })).toBe(true);
    expect(tenant('/sign-in', { authorization: 'Bearer x' })).toBe(true);
  });

  it('lets public pages through to the network-first rule', () => {
    expect(tenant('/')).toBe(false);
    expect(tenant('/sign-in')).toBe(false);
    expect(tenant('/offline')).toBe(false);
  });

  it('caches only hashed static assets and icons cache-first', () => {
    expect(isStaticAsset(new URL('/_next/static/chunks/a1b2.js', 'https://app.example.test'))).toBe(
      true,
    );
    expect(isStaticAsset(new URL('/icons/icon-192.png', 'https://app.example.test'))).toBe(true);
    expect(isStaticAsset(new URL('/api/x', 'https://app.example.test'))).toBe(false);
    expect(isStaticAsset(new URL('/', 'https://app.example.test'))).toBe(false);
  });
});

describe('offline court-day shell (#65)', () => {
  const nav = (path: string, init: { headers?: Record<string, string>; method?: string } = {}) => {
    const url = new URL(path, 'https://app.example.test');
    const request = new Request(url, init);
    Object.defineProperty(request, 'destination', { value: 'document' });
    return isOfflineShellNavigation(request, url);
  };

  it('parses only the board and brief routes', () => {
    expect(parseOfflineRoute('/w/acme/today')).toEqual({
      kind: 'board',
      slug: 'acme',
      which: 'today',
    });
    expect(parseOfflineRoute('/w/acme/tomorrow/')).toEqual({
      kind: 'board',
      slug: 'acme',
      which: 'tomorrow',
    });
    expect(parseOfflineRoute('/w/acme/briefs/L-1')).toEqual({
      kind: 'brief',
      slug: 'acme',
      listingId: 'L-1',
    });
    for (const path of [
      '/w/acme/matters',
      '/w/acme/today/x',
      '/w/acme/briefs',
      '/today',
      '/account',
    ]) {
      expect(parseOfflineRoute(path)).toBeNull();
    }
  });

  it('answers document navigations to those routes with the shell', () => {
    expect(nav('/w/acme/today')).toBe(true);
    expect(nav('/w/acme/briefs/L-1')).toBe(true);
  });

  it('never takes RSC payloads, other methods or other signed-in routes', () => {
    expect(nav('/w/acme/today', { headers: { rsc: '1' } })).toBe(false);
    expect(nav('/w/acme/today?_rsc=abc')).toBe(false);
    expect(nav('/w/acme/today', { method: 'POST' })).toBe(false);
    expect(nav('/w/acme/inbox')).toBe(false);
  });

  it('keeps those routes network-only: the shell is a fallback, not a cache', () => {
    expect(tenant('/w/acme/today')).toBe(true);
    expect(tenant('/w/acme/briefs/L-1')).toBe(true);
    expect(tenant('/offline/court-day')).toBe(false);
  });
});
