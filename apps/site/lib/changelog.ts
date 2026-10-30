// Changelog (#91): MDX entries in content/changelog, product changes only. An entry that mentions
// customers or case details fails the build, because a changelog is public.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { CONTENT_DIR, loadMdxFile, type MdxPage } from './mdx.ts';

export const CHANGELOG_DIR = path.join(CONTENT_DIR, 'changelog');

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  description: string;
  slug: string;
  content: MdxPage['content'];
}

const SEMVER = /^\d+\.\d+\.\d+$/;

/** Customer or case details that must never appear in a changelog entry. */
export const CHANGELOG_DENYLIST: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\b(customers?|clients?|litigants?|firms?|chambers? of)\b/i,
    reason: 'names a customer or client',
  },
  {
    pattern: /\b[A-Z][A-Za-z.]{0,10}\s*(?:No\.?\s*)?\d{1,6}\s*(?:of|\/)\s*(?:19|20)\d{2}\b/,
    reason: 'looks like a case number',
  },
  { pattern: /\b\w+\s+v(?:s|\.)\s+\w+/i, reason: 'looks like a case title' },
  { pattern: /[\w.+-]+@[\w-]+\.[\w.]+/, reason: 'contains an email address' },
  { pattern: /(?:\+91|\b)[6-9]\d{9}\b/, reason: 'contains a phone number' },
  { pattern: /\b(?:outcome|won|lost|verdict|judgment)\b/i, reason: 'mentions a case result' },
];

export function scanChangelog(file: string, text: string): string[] {
  const body = text.replace(/^---[\s\S]*?\n---/, '');
  const findings: string[] = [];
  body.split('\n').forEach((line, index) => {
    for (const { pattern, reason } of CHANGELOG_DENYLIST) {
      if (pattern.test(line)) findings.push(`${file}:${String(index + 1)}: ${reason}`);
    }
  });
  return findings;
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Newest first: by date, then by version for entries on the same day. */
export function sortEntries<T extends { date: string; version: string }>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => b.date.localeCompare(a.date) || compareVersions(b.version, a.version),
  );
}

export async function loadChangelog(
  dir: string = CHANGELOG_DIR,
  components: Record<string, unknown> = {},
): Promise<ChangelogEntry[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.mdx')).sort();
  const entries = await Promise.all(
    files.map(async (name) => {
      const file = path.join(dir, name);
      const findings = scanChangelog(name, await readFile(file, 'utf8'));
      if (findings.length > 0) throw new Error(`Changelog lint failed:\n${findings.join('\n')}`);
      const page = await loadMdxFile(file, components, path.dirname(dir));
      const { version, date, title, description } = page.frontmatter;
      if (version === undefined || !SEMVER.test(version)) {
        throw new Error(`content/changelog/${name}: frontmatter needs a version like 0.1.0`);
      }
      return {
        version,
        date,
        title,
        description,
        slug: name.replace(/\.mdx$/, ''),
        content: page.content,
      };
    }),
  );
  const versions = entries.map((entry) => entry.version);
  if (new Set(versions).size !== versions.length) throw new Error('Duplicate changelog version');
  return sortEntries(entries);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** RSS 2.0 for the changelog; static, built with the site. */
export function buildChangelogRss(
  entries: Pick<ChangelogEntry, 'version' | 'date' | 'title' | 'description'>[],
  pageUrl: string,
): string {
  const items = entries
    .map(
      (entry) =>
        `<item><title>${escapeXml(entry.title)}</title><link>${pageUrl}#v${entry.version}</link>` +
        `<guid isPermaLink="false">causedeck-changelog-${entry.version}</guid>` +
        `<pubDate>${new Date(`${entry.date}T00:00:00Z`).toUTCString()}</pubDate>` +
        `<description>${escapeXml(entry.description)}</description></item>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>` +
    `<title>CauseDeck changelog</title><link>${pageUrl}</link>` +
    `<description>Product changes to CauseDeck, newest first.</description>${items}</channel></rss>`
  );
}
