// Legal pages (#95): loader, status and feed helpers. The legal text itself comes from counsel
// (#117); the MDX under content/legal holds placeholder structure until it arrives.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Metadata } from 'next';

import { SUBPROCESSORS } from '../content/legal/sub-processors.ts';

import { parseLegalFrontmatter, type LegalFrontmatter } from './frontmatter.ts';
import { CONTENT_DIR, loadMdxFile, type MdxPage } from './mdx.ts';
import { pageMetadata, canonicalUrl } from './seo.ts';
import { siteEnv } from './env.ts';

export const LEGAL_SLUGS = ['terms', 'privacy', 'dpa', 'ai-disclosure', 'sub-processors'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const LEGAL_DIR = path.join(CONTENT_DIR, 'legal');

export interface LegalHeading {
  id: string;
  text: string;
}

export interface LegalPage extends MdxPage {
  legal: LegalFrontmatter;
  headings: LegalHeading[];
  /** Drafts are never indexed. */
  noindex: boolean;
}

/** True for slugs owned by the dedicated `app/legal/*` pages (the catch-all route skips them). */
export function isLegalOwned(slug: string[]): boolean {
  return (
    slug.length === 2 &&
    slug[0] === 'legal' &&
    (LEGAL_SLUGS as readonly string[]).includes(slug[1] ?? '')
  );
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `## ` headings of the MDX source, for the table of contents. */
export function extractHeadings(source: string): LegalHeading[] {
  return [...source.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => {
    const text = match[1] ?? '';
    return { id: headingId(text), text };
  });
}

export async function loadLegalPage(
  slug: LegalSlug,
  components: Record<string, unknown> = {},
): Promise<LegalPage> {
  const file = path.join(LEGAL_DIR, `${slug}.mdx`);
  const page = await loadMdxFile(file, components);
  const relative = path.relative(process.cwd(), file);
  const legal = parseLegalFrontmatter(page.frontmatter, relative);
  const source = await readFile(file, 'utf8');
  return {
    ...page,
    legal,
    headings: extractHeadings(source),
    noindex: legal.status === 'draft' || legal.noindex,
  };
}

export function loadAllLegalPages(): Promise<LegalPage[]> {
  return Promise.all(LEGAL_SLUGS.map((slug) => loadLegalPage(slug)));
}

export async function legalMetadata(slug: LegalSlug): Promise<Metadata> {
  const page = await loadLegalPage(slug);
  return pageMetadata({
    title: page.frontmatter.title,
    description: page.frontmatter.description,
    path: `legal/${slug}`,
    noindex: page.noindex,
  });
}

/** Slugs of legal pages still marked draft (the production build gate, scripts/legal-status.ts). */
export function draftSlugs(pages: { slug: string[]; legal: { status: string } }[]): string[] {
  return pages.filter((page) => page.legal.status === 'draft').map((page) => page.slug.join('/'));
}

export interface FeedItem {
  title: string;
  link: string;
  guid: string;
  date: string;
  summary: string;
}

const xml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Change notices: one item per sub-processor effective date plus every version-history entry of
 * the sub-processors page, newest first.
 */
export function subprocessorFeedItems(
  history: { date: string; summary: string }[],
  siteUrl: string = siteEnv.siteUrl,
): FeedItem[] {
  const link = canonicalUrl('legal/sub-processors', siteUrl);
  const entries: FeedItem[] = SUBPROCESSORS.map((row) => ({
    title: `Sub-processor effective: ${row.name}`,
    link,
    guid: `${link}#${row.id}-${row.effectiveDate}`,
    date: row.effectiveDate,
    summary: `${row.name}: ${row.purpose} Region: ${row.region}.`,
  }));
  for (const entry of history) {
    entries.push({
      title: `Sub-processor list updated ${entry.date}`,
      link,
      guid: `${link}#history-${entry.date}`,
      date: entry.date,
      summary: entry.summary,
    });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date) || a.guid.localeCompare(b.guid));
}

export function renderFeed(items: FeedItem[], siteUrl: string = siteEnv.siteUrl): string {
  const channelLink = canonicalUrl('legal/sub-processors', siteUrl);
  const body = items
    .map(
      (item) =>
        `    <item>\n      <title>${xml(item.title)}</title>\n      <link>${xml(item.link)}</link>\n      <guid isPermaLink="false">${xml(item.guid)}</guid>\n      <pubDate>${new Date(`${item.date}T00:00:00Z`).toUTCString()}</pubDate>\n      <description>${xml(item.summary)}</description>\n    </item>`,
    )
    .join('\n');
  const latest = items[0]?.date ?? '1970-01-01';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>CauseDeck sub-processor changes</title>\n    <link>${xml(channelLink)}</link>\n    <description>Changes to the CauseDeck sub-processor list.</description>\n    <lastBuildDate>${new Date(`${latest}T00:00:00Z`).toUTCString()}</lastBuildDate>\n${body}\n  </channel>\n</rss>\n`;
}

/** Manifest services (infra/sub-processors.json) that the public list does not name. */
export function missingFromPublicList(
  manifest: { services: { id: string }[] },
  rows: readonly { id: string }[],
): string[] {
  const listed = new Set(rows.map((row) => row.id));
  return manifest.services.map((service) => service.id).filter((id) => !listed.has(id));
}
