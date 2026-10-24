// A small RSS 2.0 and Atom reader (#481). It reads only headline, link, date and the feed's own
// summary (`description` / `summary`). `content:encoded`, `content` and every other body-like
// element are never read, so full article text cannot enter the pipeline from a feed.
import { toExcerpt, toTitle } from './excerpt.ts';
import type { FeedEntry } from './types.ts';

function block(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  return Array.from(xml.matchAll(re), (m) => m[1] ?? '');
}

function text(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const value = re.exec(xml)?.[1];
  return value === undefined ? null : value;
}

function atomLink(entry: string): string | null {
  const links = Array.from(entry.matchAll(/<link\b([^>]*?)\/?>/gi), (m) => m[1] ?? '');
  const attr = (s: string, name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(s)?.[1] ?? null;
  const alternate = links.find((l) => (attr(l, 'rel') ?? 'alternate') === 'alternate');
  return alternate === undefined ? null : attr(alternate, 'href');
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(toTitle(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function httpUrl(value: string | null): string | null {
  if (value === null) return null;
  const candidate = toTitle(value);
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Entries of an RSS 2.0 or Atom document; entries without a headline or a web link are dropped. */
export function parseFeed(xml: string): FeedEntry[] {
  const rss = block(xml, 'item');
  const atom = rss.length === 0 ? block(xml, 'entry') : [];
  const entries: FeedEntry[] = [];
  for (const raw of [...rss, ...atom]) {
    const isAtom = atom.length > 0;
    const title = toTitle(text(raw, 'title') ?? '');
    const url = httpUrl(isAtom ? atomLink(raw) : text(raw, 'link'));
    if (title === '' || url === null) continue;
    entries.push({
      title,
      url,
      publishedAt: parseDate(
        isAtom
          ? (text(raw, 'published') ?? text(raw, 'updated'))
          : (text(raw, 'pubDate') ?? text(raw, 'dc:date')),
      ),
      excerpt: toExcerpt(isAtom ? text(raw, 'summary') : text(raw, 'description')),
    });
  }
  return entries;
}
