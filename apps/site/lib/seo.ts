import type { Metadata, MetadataRoute } from 'next';

import { siteEnv } from './env.ts';

export const SITE_NAME = 'CauseDeck';
export const SITE_TAGLINE = 'Software for advocates';

export interface PageSeo {
  title: string;
  description: string;
  /** Path below the site root without slashes at the ends; '' is the home page. */
  path: string;
  noindex?: boolean;
}

/** Absolute canonical URL; the site uses trailing slashes (next.config.ts). */
export function canonicalUrl(pagePath: string, siteUrl: string = siteEnv.siteUrl): string {
  const clean = pagePath.replace(/^\/+|\/+$/g, '');
  return clean === '' ? `${siteUrl}/` : `${siteUrl}/${clean}/`;
}

/** Title, description, canonical, Open Graph, Twitter and robots for one page. */
export function pageMetadata(seo: PageSeo, siteUrl: string = siteEnv.siteUrl): Metadata {
  const url = canonicalUrl(seo.path, siteUrl);
  const title = seo.path === '' ? `${SITE_NAME}: ${seo.title}` : `${seo.title} | ${SITE_NAME}`;
  return {
    title,
    description: seo.description,
    alternates: { canonical: url },
    robots: seo.noindex === true ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title,
      description: seo.description,
      url,
    },
    twitter: { card: 'summary_large_image', title, description: seo.description },
  };
}

/** The only structured data on the site: the product as SoftwareApplication (never a legal service). */
export function softwareApplicationJsonLd(
  siteUrl: string = siteEnv.siteUrl,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    description: 'Practice software for advocates: cases, cause lists and court-day preparation.',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: `${siteUrl}/`,
  };
}

export function sitemapEntries(
  pages: { path: string; noindex?: boolean; date?: string }[],
  siteUrl: string = siteEnv.siteUrl,
): MetadataRoute.Sitemap {
  return pages
    .filter((page) => page.noindex !== true)
    .map((page) => ({
      url: canonicalUrl(page.path, siteUrl),
      ...(page.date === undefined ? {} : { lastModified: page.date }),
    }));
}
