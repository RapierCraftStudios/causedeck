// Serves apps/site/out the way Cloudflare Pages does: clean URLs with trailing slashes, 404.html
// with a 404 status, and the response headers from out/_headers, so the Playwright specs run
// under the real Content-Security-Policy. Usage: node static-server.mjs <dir> <port>
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const [dir = '../apps/site/out', port = '3300'] = process.argv.slice(2);
const root = path.resolve(dir);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

/** `_headers`: unindented lines are path rules, indented `Name: value` lines belong to the rule above. */
function parseHeaders(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (/^\S/.test(raw)) rules.push({ pattern: raw.trim(), headers: [] });
    else {
      const [name, ...rest] = raw.trim().split(':');
      rules.at(-1)?.headers.push([name.trim(), rest.join(':').trim()]);
    }
  }
  return rules;
}

const rules = parseHeaders(readFileSync(path.join(root, '_headers'), 'utf8'));
const matches = (pattern, pathname) =>
  pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pattern === pathname;

function resolveFile(pathname) {
  const candidates = pathname.endsWith('/')
    ? [path.join(pathname, 'index.html')]
    : [pathname, `${pathname}.html`];
  for (const candidate of candidates) {
    const full = path.join(root, candidate);
    if (full.startsWith(root) && statSync(full, { throwIfNoEntry: false })?.isFile()) return full;
  }
  return undefined;
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const decoded = decodeURIComponent(pathname);
  // Cloudflare redirects /about to /about/ when about/index.html exists.
  if (!decoded.endsWith('/') && !path.extname(decoded) && resolveFile(`${decoded}/`)) {
    res.writeHead(308, { location: `${decoded}/` }).end();
    return;
  }
  const file = resolveFile(decoded);
  const served = file ?? path.join(root, '404.html');
  const headers = { 'content-type': TYPES[path.extname(served)] ?? 'application/octet-stream' };
  for (const rule of rules) {
    if (!matches(rule.pattern, decoded)) continue;
    for (const [name, value] of rule.headers) {
      const key = name.toLowerCase();
      headers[key] = headers[key] === undefined ? value : `${headers[key]}, ${value}`;
    }
  }
  res.writeHead(file ? 200 : 404, headers).end(readFileSync(served));
}).listen(Number(port), () => {
  console.log(`site ready on ${port}`);
});
