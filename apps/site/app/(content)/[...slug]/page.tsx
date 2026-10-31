import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { mdxComponents, Prose } from '../../../components/prose.tsx';
import { isLegalOwned } from '../../../lib/legal.ts';
import { loadAllMdx, loadMdxPage } from '../../../lib/mdx.ts';
import { isPageOwned } from '../../../lib/pages.ts';
import { pageMetadata } from '../../../lib/seo.ts';

export const dynamicParams = false;

interface Props {
  params: Promise<{ slug: string[] }>;
}

export async function generateStaticParams() {
  const pages = await loadAllMdx();
  // The dedicated app/legal/* pages own their slugs.
  return pages
    .filter((page) => !isLegalOwned(page.slug) && !isPageOwned(page.slug))
    .map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadMdxPage(slug);
  if (page === undefined) return {};
  return pageMetadata({
    title: page.frontmatter.title,
    description: page.frontmatter.description,
    path: slug.join('/'),
    noindex: page.frontmatter.noindex,
  });
}

export default async function ContentPage({ params }: Props) {
  const { slug } = await params;
  const page = await loadMdxPage(slug, mdxComponents);
  if (page === undefined) notFound();
  return <Prose>{page.content}</Prose>;
}
