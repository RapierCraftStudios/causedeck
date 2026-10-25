// `/w/[slug]/courts/[code]/halls` (#400, #42): the halls named in this workspace's lists for
// the forum (`listHallsSeen`, RLS-scoped, so other workspaces' parse runs never show), with the
// newest list date and an unreadable indicator; an educational empty state with none.
import { notFound } from 'next/navigation';

import { CourtsLoadError } from '../../../../../../../components/courts/forum-list.tsx';
import { HallsTable } from '../../../../../../../components/courts/halls-table.tsx';
import { PermissionDeniedPage } from '../../../../../../../components/shell/permission-denied-page.tsx';
import { forumCodeParam, loadCourtData } from '../../../../../../../lib/court-forum-loader.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

interface HallsPageProps {
  params: Promise<{ slug: string; code: string }>;
}

export default async function ForumHallsPage({ params }: HallsPageProps) {
  const { slug, code: segment } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const code = forumCodeParam(segment);
  const loaded = await loadCourtData(context, 'the halls', (court, tx, workspaceId) =>
    court.listHallsSeen(tx, workspaceId, code),
  );
  if (loaded.kind === 'not-found') notFound();
  if (loaded.kind === 'denied') return <PermissionDeniedPage />;
  if (loaded.kind === 'error') return <CourtsLoadError />;
  return <HallsTable halls={loaded.value} />;
}
