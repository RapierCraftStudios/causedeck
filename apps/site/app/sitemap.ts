import type { MetadataRoute } from 'next';

import { isLegalOwned, loadAllLegalPages } from '../lib/legal.ts';
import { loadAllMdx } from '../lib/mdx.ts';
import { sitemapEntries } from '../lib/seo.ts';

export const dynamic = 'force-static';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = (await loadAllMdx()).filter((page) => !isLegalOwned(page.slug));
  const legal = await loadAllLegalPages();
  return sitemapEntries([
    { path: '' },
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
