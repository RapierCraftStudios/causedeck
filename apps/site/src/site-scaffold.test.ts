import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readSiteEnv } from '../lib/env.ts';
import { parseFrontmatter } from '../lib/frontmatter.ts';
import {
  canonicalUrl,
  pageMetadata,
  sitemapEntries,
  softwareApplicationJsonLd,
} from '../lib/seo.ts';
import { scanText } from '../scripts/rule36-lint.ts';
import { buildHeaders, inlineScriptHashes } from '../scripts/write-headers.ts';

const root = path.join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('static export (R1)', () => {
  it('exports statically with no middleware, rewrites or headers()', () => {
    const config = read('next.config.ts');
    expect(config).toContain("output: 'export'");
    expect(config).not.toMatch(/async\s+(rewrites|redirects|headers)\s*\(/);
    for (const name of ['middleware.ts', 'src/middleware.ts', 'proxy.ts']) {
      expect(existsSync(path.join(root, name))).toBe(false);
    }
  });
});

describe('frontmatter (R2)', () => {
  const valid = { title: 'T', description: 'D', date: '2026-01-01' };
  it('accepts valid frontmatter and defaults noindex', () => {
    expect(parseFrontmatter(valid, 'a.mdx').noindex).toBe(false);
  });
  it('rejects missing, unknown and malformed fields with the file name', () => {
    expect(() => parseFrontmatter({ ...valid, title: '' }, 'a.mdx')).toThrow(/a\.mdx/);
    expect(() => parseFrontmatter({ ...valid, extra: 1 }, 'a.mdx')).toThrow();
    expect(() => parseFrontmatter({ ...valid, date: 'soon' }, 'a.mdx')).toThrow();
  });
});

describe('seo (R3, R4)', () => {
  it('builds canonical, Open Graph, Twitter and robots metadata', () => {
    const meta = pageMetadata(
      { title: 'About', description: 'd', path: 'about', noindex: true },
      'https://x.test',
    );
    expect(meta.alternates?.canonical).toBe('https://x.test/about/');
    expect(meta.openGraph?.url).toBe('https://x.test/about/');
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image' });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(canonicalUrl('', 'https://x.test')).toBe('https://x.test/');
  });
  it('omits noindex pages from the sitemap', () => {
    const urls = sitemapEntries(
      [{ path: '' }, { path: 'legal/draft', noindex: true }],
      'https://x.test',
    );
    expect(urls.map((entry) => entry.url)).toEqual(['https://x.test/']);
  });
  it('emits SoftwareApplication JSON-LD only', () => {
    expect(softwareApplicationJsonLd()['@type']).toBe('SoftwareApplication');
    const sources = ['app/page.tsx', 'lib/seo.ts', 'app/layout.tsx'].map(read).join('\n');
    expect(sources).not.toMatch(/LegalService|Attorney|AggregateRating|"Review"|'Review'/);
  });
});

describe('rule 36 lint (R5)', () => {
  it.each([
    'best lawyer',
    'top advocate',
    'win rate',
    'guaranteed outcome',
    'find a lawyer',
    'client reviews',
    'testimonial',
  ])('flags "%s"', (term) => {
    expect(scanText('x.mdx', `We offer ${term} here`)).not.toHaveLength(0);
  });
  it('flags Testimonial* and Directory* components', () => {
    expect(scanText('a.tsx', 'export function TestimonialCard() {}')).not.toHaveLength(0);
    expect(scanText('a.tsx', 'const x = <DirectoryList />')).not.toHaveLength(0);
  });
  it('passes plain copy', () => {
    expect(scanText('a.mdx', 'Software for advocates.')).toEqual([]);
  });
});

describe('env (R6)', () => {
  it('has analytics off by default and treats blank values as unset', () => {
    expect(readSiteEnv({}).analyticsSrc).toBeUndefined();
    expect(readSiteEnv({ NEXT_PUBLIC_ANALYTICS_SRC: '' }).analyticsSrc).toBeUndefined();
  });
  it('rejects non-https URLs', () => {
    expect(() => readSiteEnv({ NEXT_PUBLIC_SITE_URL: 'http://evil.test' })).toThrow();
  });
});

describe('headers (R12)', () => {
  const html =
    '<script>a()</script><script type="application/ld+json">{}</script><script src="/x.js"></script>';
  it('hashes only executable inline scripts', () => {
    expect(inlineScriptHashes(html)).toHaveLength(1);
  });
  it('writes a CSP without unsafe-inline scripts', () => {
    const out = buildHeaders(read('public/_headers'), [{ route: '/', html }]);
    expect(out).toMatch(/script-src 'self' 'sha256-/);
    expect(out).not.toMatch(/script-src[^\n]*unsafe-inline/);
    for (const header of ['Strict-Transport-Security', 'Referrer-Policy', 'Permissions-Policy']) {
      expect(out).toContain(header);
    }
    expect(out).toMatch(/_next\/static\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  });
});
