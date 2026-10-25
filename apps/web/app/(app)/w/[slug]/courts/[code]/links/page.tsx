// `/w/[slug]/courts/[code]/links` (#400, #42; ADR 0014): the forum's official pages as
// new-window anchors with the captcha notice where the court asks for one. Links come from the
// catalogue through `getForumDetail`; nothing here fetches or frames a court page.
import { notFound } from 'next/navigation';

import { DeepLinkList } from '../../../../../../../components/courts/deep-link-list.tsx';
import { CourtsLoadError } from '../../../../../../../components/courts/forum-list.tsx';
import { PermissionDeniedPage } from '../../../../../../../components/shell/permission-denied-page.tsx';
import { forumCodeParam, loadCourtData } from '../../../../../../../lib/court-forum-loader.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

interface LinksPageProps {
  params: Promise<{ slug: string; code: string }>;
}

export default async function ForumLinksPage({ params }: LinksPageProps) {
  const { slug, code: segment } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const code = forumCodeParam(segment);
  const loaded = await loadCourtData(context, 'the links', async (court, tx, workspaceId) => {
    const detail = await court.getForumDetail(tx, workspaceId, code);
    return detail.deepLinks;
  });
  if (loaded.kind === 'not-found') notFound();
  if (loaded.kind === 'denied') return <PermissionDeniedPage />;
  if (loaded.kind === 'error') return <CourtsLoadError />;
  return <DeepLinkList links={loaded.value} />;
}
