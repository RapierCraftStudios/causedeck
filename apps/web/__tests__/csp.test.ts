import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { buildCsp, createNonce, localeFromAcceptLanguage, negotiateLocale } from '../lib/csp.ts';
import { config, proxy } from '../proxy.ts';

const request = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost:3000/sign-in', { headers });

describe('buildCsp', () => {
  const csp = buildCsp('abc123');

  it.each([
    "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "default-src 'self'",
    "font-src 'self'",
  ])('contains %s', (directive) => {
    expect(csp.split('; ')).toContain(directive);
  });

  it("adds 'unsafe-eval' only in development", () => {
    expect(csp).not.toContain('unsafe-eval');
    expect(buildCsp('n', { dev: true })).toContain(
      "script-src 'self' 'nonce-n' 'strict-dynamic' 'unsafe-eval'",
    );
  });

  it('never allows Google Fonts or other origins for fonts and styles', () => {
    expect(csp).not.toMatch(/googleapis|gstatic|https:/);
  });
});

describe('createNonce', () => {
  it('is base64 with 128 bits and differs per call', () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});

describe('locale negotiation', () => {
  it.each([
    ['ta-IN,en;q=0.8', 'ta'],
    ['kn', 'kn'],
    ['fr-FR,de;q=0.9', 'en'],
    ['en-GB;q=0.5,kn;q=0.9', 'kn'],
    ['ta;q=0', 'en'],
    ['', 'en'],
  ])('Accept-Language %j -> %s', (header, locale) => {
    expect(localeFromAcceptLanguage(header)).toBe(locale);
  });

  it('prefers a valid cookie and ignores an unknown one', () => {
    expect(negotiateLocale('kn', 'ta')).toBe('kn');
    expect(negotiateLocale('fr', 'ta')).toBe('ta');
  });
});

describe('proxy', () => {
  it('sets a fresh per-request nonce on the request (x-nonce) and the response CSP', () => {
    const first = proxy(request());
    const second = proxy(request());

    const csp = first.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeDefined();
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(second.headers.get('content-security-policy')).not.toBe(csp);
  });

  it('sets NEXT_LOCALE from Accept-Language when the cookie is missing', () => {
    const response = proxy(request({ 'accept-language': 'ta-IN,en;q=0.5' }));
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('ta');
  });

  it('defaults NEXT_LOCALE to en', () => {
    expect(proxy(request()).cookies.get('NEXT_LOCALE')?.value).toBe('en');
  });

  it('leaves an existing NEXT_LOCALE cookie alone', () => {
    const response = proxy(request({ cookie: 'NEXT_LOCALE=kn', 'accept-language': 'ta' }));
    expect(response.cookies.get('NEXT_LOCALE')).toBeUndefined();
  });

  it('skips static assets and the health probes', () => {
    const source = new RegExp(`^${config.matcher[0]?.source ?? ''}$`);
    expect(source.test('/sign-in')).toBe(true);
    expect(source.test('/')).toBe(true);
    for (const path of ['/_next/static/chunks/a.js', '/_next/image', '/healthz', '/readyz']) {
      expect(source.test(path)).toBe(false);
    }
  });
});
