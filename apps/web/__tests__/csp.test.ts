import { FORUM_CATALOGUE } from '@causedeck/db/seed/forum-catalogue';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import {
  buildCsp,
  createNonce,
  localeFromAcceptLanguage,
  negotiateLocale,
  uploadOriginOf,
} from '../lib/csp.ts';
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
    "worker-src 'self'",
  ])('contains %s', (directive) => {
    expect(csp.split('; ')).toContain(directive);
  });

  it("adds 'unsafe-eval' only in development", () => {
    expect(csp).not.toContain('unsafe-eval');
    expect(buildCsp('n', { dev: true })).toContain(
      "script-src 'self' 'nonce-n' 'strict-dynamic' 'unsafe-eval'",
    );
  });

  it("keeps connect-src to 'self' unless an upload origin is given (#459)", () => {
    expect(csp.split('; ')).toContain("connect-src 'self'");
    expect(buildCsp('n', { uploadOrigin: 'http://127.0.0.1:9000' }).split('; ')).toContain(
      "connect-src 'self' http://127.0.0.1:9000",
    );
  });

  it('derives the upload origin from the storage env (#459)', () => {
    expect(uploadOriginOf({ S3_ENDPOINT: 'http://127.0.0.1:9000/', S3_BUCKET: 'b' })).toBe(
      'http://127.0.0.1:9000',
    );
    expect(uploadOriginOf({ S3_BUCKET: 'docs', S3_REGION: 'ap-south-1' })).toBe(
      'https://docs.s3.ap-south-1.amazonaws.com',
    );
    expect(uploadOriginOf({ S3_ENDPOINT: 'not a url' })).toBeUndefined();
    expect(uploadOriginOf({})).toBeUndefined();
  });

  it('never allows Google Fonts or other origins for fonts and styles', () => {
    expect(csp).not.toMatch(/googleapis|gstatic|https:/);
  });
});

describe('court hosts are never framed (#399)', () => {
  // Madras HC forbids framing its pages, and the courts area only links out to them (#42).
  const courtHosts = [...new Set(FORUM_CATALOGUE.flatMap((forum) => forum.config.hosts))];

  /** The sources that govern frames: `frame-src`, else `child-src`, else `default-src`. */
  function frameSources(csp: string): string[] {
    const directives = new Map(
      csp.split('; ').map((directive) => {
        const [name = '', ...sources] = directive.trim().split(/\s+/);
        return [name, sources] as const;
      }),
    );
    return (
      directives.get('frame-src') ??
      directives.get('child-src') ??
      directives.get('default-src') ??
      []
    );
  }

  it('checks a real host list', () => {
    expect(courtHosts.length).toBeGreaterThan(0);
  });

  it.each([
    ['production', buildCsp('n')],
    ['development', buildCsp('n', { dev: true })],
  ])('allows frames from this origin only in %s', (_mode, csp) => {
    const sources = frameSources(csp);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(["'self'", "'none'"]).toContain(source);
    for (const host of courtHosts) {
      const labels = host.split('.');
      const wildcards = labels.slice(1).map((_, i) => `*.${labels.slice(i + 1).join('.')}`);
      for (const source of sources) {
        expect(source).not.toContain(host);
        expect(wildcards).not.toContain(source.replace(/^https?:\/\//, ''));
      }
    }
    expect(sources).not.toContain('*');
    expect(sources.some((source) => /^(?:https?|data|blob):$/.test(source))).toBe(false);
    expect(csp.split('; ')).toContain("object-src 'none'");
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
