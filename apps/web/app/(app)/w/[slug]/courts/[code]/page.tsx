// `/w/[slug]/courts/[code]` (#400): the forum opens on its Halls tab.
import { redirect } from 'next/navigation';

import { forumCodeParam } from '../../../../../../lib/court-forum-loader.ts';

interface ForumPageProps {
  params: Promise<{ slug: string; code: string }>;
}

export default async function ForumPage({ params }: ForumPageProps) {
  const { slug, code: segment } = await params;
  const code = forumCodeParam(segment);
  redirect(`/w/${encodeURIComponent(slug)}/courts/${encodeURIComponent(code)}/halls`);
}
