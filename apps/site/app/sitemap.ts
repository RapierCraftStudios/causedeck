import type { MetadataRoute } from 'next';

import { loadChangelog } from '../lib/changelog.ts';
import { isLegalOwned, loadAllLegalPages } from '../lib/legal.ts';
import { loadAllMdx } from '../lib/mdx.ts';
import { isPageOwned } from '../lib/pages.ts';
import { sitemapEntries } from '../lib/seo.ts';

export const dynamic = 'force-static';

const dated = (date: string | undefined) => (date === undefined ? {} : { date });

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const all = await loadAllMdx();
  const pages = all.filter((page) => !isLegalOwned(page.slug) && !isPageOwned(page.slug));
  const dateOf = (slug: string) =>
    all.find((page) => page.slug.join('/') === slug)?.frontmatter.date;
  const [latest] = await loadChangelog();
  const legal = await loadAllLegalPages();
  return sitemapEntries([
    { path: '' },
    { path: 'pricing' },
    { path: 'security', ...dated(dateOf('security')) },
    { path: 'about', ...dated(dateOf('about')) },
    { path: 'changelog', ...dated(latest?.date) },
    { path: 'status' },
    { path: 'status/history' },
    ...pages.map((page) => ({
      path: page.slug.join('/'),
      noindex: page.frontmatter.noindex,
      date: page.frontmatter.date,
    })),
    // Draft legal pages are noindex and so stay out of the sitemap.
    ...legal.map((page) => ({
      path: page.slug.join('/'),
      noindex: page.noindex,
      date: page.frontmatter.date,
    })),
  ]);
}
