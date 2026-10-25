// Post-build step: write out/_headers (Cloudflare Pages) with a CSP that has no inline-script
// allowance. Next's static export and next-themes both emit inline scripts, so each page's inline
// scripts are hashed into that page's own `script-src` rule. Run after `next build`.
//   tsx scripts/write-headers.ts
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const INLINE_SCRIPT = /<script((?:\s[^>]*)?)>([\s\S]*?)<\/script>/g;
/** Cloudflare Pages allows 100 header rules per file. */
const MAX_RULES = 100;

/** sha256 CSP sources for every executable inline script in a page. */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const [, attributes = '', body = ''] of html.matchAll(INLINE_SCRIPT)) {
    if (/\ssrc\s*=/.test(attributes)) continue;
    const type = /\stype\s*=\s*["']([^"']*)["']/.exec(attributes)?.[1];
    // Data blocks (JSON-LD, importmap-less JSON) never execute and need no hash.
    if (type !== undefined && type !== '' && type !== 'module' && type !== 'text/javascript') continue;
    hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  return [...hashes].sort();
}

function origin(url: string | undefined): string | undefined {
  return url === undefined || url === '' ? undefined : new URL(url).origin;
}

/** The page-independent policy: everything except script-src, which is per route. */
export function baseCsp(analyticsOrigin?: string): string {
  const connect = ["'self'", ...(analyticsOrigin === undefined ? [] : [analyticsOrigin])];
  return [
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connect.join(' ')}`,
  ].join('; ');
}

export function routeFor(relativeHtml: string): string {
  const posix = relativeHtml.split(path.sep).join('/');
  if (posix === 'index.html') return '/';
  if (posix.endsWith('/index.html')) return `/${posix.slice(0, -'index.html'.length)}`;
  return `/${posix}`;
}

export function buildHeaders(
  base: string,
  pages: { route: string; html: string }[],
  analyticsSrc?: string,
): string {
  const analyticsOrigin = origin(analyticsSrc);
  const rules = pages.map(({ route, html }) => {
    const sources = ["'self'", ...inlineScriptHashes(html), ...(analyticsOrigin ? [analyticsOrigin] : [])];
    return `${route}\n  Content-Security-Policy: script-src ${sources.join(' ')}`;
  });
  if (rules.length + 3 > MAX_RULES) {
    throw new Error(`write-headers: ${rules.length} page rules exceed the Cloudflare _headers limit`);
  }
  return [
    base.trimEnd(),
    '',
    '/*',
    `  Content-Security-Policy: ${baseCsp(analyticsOrigin)}`,
    '',
    ...rules.flatMap((rule) => [rule, '']),
  ].join('\n');
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_next' || entry.name === '_not-found' ? [] : htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  const outDir = path.join(root, 'out');
  const pages = htmlFiles(outDir)
    .sort()
    .map((file) => ({
      route: routeFor(path.relative(outDir, file)),
      html: readFileSync(file, 'utf8'),
    }));
  const base = readFileSync(path.join(root, 'public', '_headers'), 'utf8');
  // eslint-disable-next-line no-process-env -- build-time switch, same variable as lib/env.ts.
  const analyticsSrc = process.env.NEXT_PUBLIC_ANALYTICS_SRC;
  writeFileSync(path.join(outDir, '_headers'), buildHeaders(base, pages, analyticsSrc));
  console.log(`Wrote out/_headers for ${pages.length} page(s).`);
}
