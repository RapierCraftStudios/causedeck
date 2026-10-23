// `/w/[slug]/courts/[code]/adapter` (#400, #42): the forum adapter's status (version, level,
// verification, health across workspaces as counts, this workspace's last parse) and the access
// modes the registry allows it, with counsel's notes.
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AccessModesTable } from '../../../../../../../components/courts/access-modes-table.tsx';
import { AdapterStatusCard } from '../../../../../../../components/courts/adapter-status-card.tsx';
import { CourtsLoadError } from '../../../../../../../components/courts/forum-list.tsx';
import { PermissionDeniedPage } from '../../../../../../../components/shell/permission-denied-page.tsx';
import { forumCodeParam, loadCourtData } from '../../../../../../../lib/court-forum-loader.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

interface AdapterPageProps {
  params: Promise<{ slug: string; code: string }>;
}

export default async function ForumAdapterPage({ params }: AdapterPageProps) {
  const { slug, code: segment } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const code = forumCodeParam(segment);
  const loaded = await loadCourtData(context, 'the adapter', async (court, tx, workspaceId) => {
    const detail = await court.getForumDetail(tx, workspaceId, code);
    const adapterId = detail.forum.adapterId;
    const status =
      adapterId === null ? null : await court.getAdapterStatus(tx, workspaceId, adapterId);
    return { status, accessModes: detail.accessModes };
  });
  if (loaded.kind === 'not-found') notFound();
  if (loaded.kind === 'denied') return <PermissionDeniedPage />;
  if (loaded.kind === 'error') return <CourtsLoadError />;

  const t = await getTranslations('courts.detail.adapter');
  const { status, accessModes } = loaded.value;
  return (
    <div className="flex flex-col gap-6">
      {status === null ? (
        <p className="text-ink-muted text-sm" data-adapter-none="">
          {t('noAdapter')}
        </p>
      ) : (
        <AdapterStatusCard status={status} />
      )}
      <AccessModesTable modes={accessModes} />
    </div>
  );
}
