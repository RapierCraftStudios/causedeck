import { Badge } from '@causedeck/ui/badge';
import type { Metadata } from 'next';
import Link from 'next/link';

import { loadAllLegalPages } from '../../lib/legal.ts';
import { legalChrome } from '../../lib/legal-chrome.ts';
import { pageMetadata } from '../../lib/seo.ts';

// The index lists drafts, so it stays out of search engines until every page is final.
export async function generateMetadata(): Promise<Metadata> {
  const pages = await loadAllLegalPages();
  return pageMetadata({
    title: 'Legal',
    description: 'Terms, privacy, data processing, AI disclosure and sub-processors for CauseDeck.',
    path: 'legal',
    noindex: pages.some((page) => page.legal.status === 'draft'),
  });
}

export default async function LegalIndexPage() {
  const pages = await loadAllLegalPages();
  const chrome = legalChrome();
  return (
    <div className="mx-auto max-w-[680px]">
      <h1 className="font-serif text-3xl font-semibold">{chrome.indexTitle}</h1>
      <p className="text-ink-muted mt-3">{chrome.languageNote}</p>
      <ul className="mt-8 space-y-4">
        {pages.map((page) => (
          <li key={page.slug.join('/')}>
            <Link
              href={`/${page.slug.join('/')}/`}
              prefetch={false}
              className="font-serif text-xl underline"
            >
              {page.frontmatter.title}
            </Link>{' '}
            {page.legal.status === 'draft' ? (
              <Badge tone="warning">{chrome.draftBadge}</Badge>
            ) : null}
            <p className="text-ink-muted text-sm">
              {chrome.version} {page.legal.version}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
