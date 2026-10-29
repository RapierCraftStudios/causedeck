// `/w/[slug]/help/[article]` (#94): one article opened beside the list.
import { notFound } from 'next/navigation';

import { HelpPage } from '../../../../../../components/help/help-page.tsx';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

interface Props {
  params: Promise<{ slug: string; article: string }>;
}

export default async function HelpArticlePage({ params }: Props) {
  const { slug, article } = await params;
  if (!(await getWorkspaceContext(slug))) notFound();
  return <HelpPage slug={slug} article={article} />;
}
