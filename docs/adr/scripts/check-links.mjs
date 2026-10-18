// Checks that relative Markdown links (and their #anchors) resolve:
// `node docs/adr/scripts/check-links.mjs [file|dir ...]` (`pnpm docs:links`).
// Defaults to docs/adr and the technical spike. External links are not fetched.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const DEFAULT_TARGETS = [
  path.join(root, 'docs/adr'),
  path.join(root, 'docs/engineering/13-technical-architecture-spike.md'),
];
const SKIP_DIRS = new Set(['__fixtures__', 'node_modules']);

/** GitHub-style heading anchor. */
export function slugifyHeading(text) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/ /g, '-');
}

/** Lines with fenced code blanked out (and inline code too, unless `keepInlineCode`). */
function proseLines(text, { keepInlineCode = false } = {}) {
  let fenced = false;
  return text.split(/\r?\n/).map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return '';
    }
    if (fenced) return '';
    return keepInlineCode ? line : line.replace(/`[^`]*`/g, '');
  });
}

export function anchorsOf(text) {
  const anchors = new Set();
  const counts = new Map();
  for (const line of proseLines(text, { keepInlineCode: true })) {
    const heading = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!heading) continue;
    const base = slugifyHeading(heading[1]);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
  }
  for (const match of text.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(match[1]);
  return anchors;
}

/** Inline links and images: `[text](target "title")`, with line numbers. */
export function linksOf(text) {
  const links = [];
  proseLines(text).forEach((line, i) => {
    for (const match of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ target: match[1], line: i + 1 });
    }
  });
  return links;
}

function markdownFiles(target) {
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : markdownFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

/** Returns `file:line: message` strings for every broken relative link. */
export function checkLinks(targets) {
  const problems = [];
  const anchorCache = new Map();
  const anchors = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(readFileSync(file, 'utf8')));
    return anchorCache.get(file);
  };
  for (const file of targets.flatMap(markdownFiles)) {
    for (const { target, line } of linksOf(readFileSync(file, 'utf8'))) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
      const [rawPath, fragment] = target.split('#');
      const linkPath = decodeURIComponent(rawPath);
      const resolved = linkPath ? path.resolve(path.dirname(file), linkPath) : file;
      const where = `${path.relative(process.cwd(), file)}:${line}`;
      if (!existsSync(resolved)) {
        problems.push(`${where}: ${target} does not exist`);
        continue;
      }
      if (
        fragment &&
        resolved.endsWith('.md') &&
        !anchors(resolved).has(decodeURIComponent(fragment))
      )
        problems.push(`${where}: ${target} has no heading #${fragment}`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const targets = args.length ? args.map((arg) => path.resolve(arg)) : DEFAULT_TARGETS;
  const missing = targets.filter((target) => !existsSync(target));
  if (missing.length) {
    console.error(`docs:links: not found: ${missing.join(', ')}`);
    process.exit(2);
  }
  const problems = checkLinks(targets);
  if (problems.length) {
    for (const problem of problems) console.error(`docs:links: ${problem}`);
    process.exit(1);
  }
  console.log('docs:links: OK');
}
