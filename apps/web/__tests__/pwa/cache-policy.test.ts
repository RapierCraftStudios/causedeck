import { describe, expect, it } from 'vitest';

import { isStaticAsset, isTenantRequest } from '../../lib/pwa/cache-policy.ts';

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
