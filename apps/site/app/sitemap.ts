import type { MetadataRoute } from 'next';

import { loadAllMdx } from '../lib/mdx.ts';
import { sitemapEntries } from '../lib/seo.ts';

export const dynamic = 'force-static';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = await loadAllMdx();
  return sitemapEntries([
    { path: '' },
    { path: 'status' },
    { path: 'status/history' },
    ...pages.map((page) => ({
      path: page.slug.join('/'),
      noindex: page.frontmatter.noindex,
      date: page.frontmatter.date,
    })),
  ]);
}
