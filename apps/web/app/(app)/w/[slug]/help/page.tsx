// `/w/[slug]/help` (#94): the help center. Search and the article list run in the browser over the
// bundled index, so the page works offline and no query is sent anywhere.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { HelpPage } from '../../../../../components/help/help-page.tsx';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('help');
  return { title: t('title') };
}

export default async function HelpIndexPage({ params }: Props) {
  const { slug } = await params;
  if (!(await getWorkspaceContext(slug))) notFound();
  return <HelpPage slug={slug} article={undefined} />;
}
