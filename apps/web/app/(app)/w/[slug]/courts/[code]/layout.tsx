// `/w/[slug]/courts/[code]/*` (#400, #42): a forum's detail shell. It reads the forum's detail
// and this workspace's courts index (for the latest parse and the official cause-list link the
// degraded banner uses) in the workspace's RLS scope, then renders the header, the Halls, Adapter
// and Links tabs and the tab's page. Every role reads it. An unknown code, or another workspace's
// custom forum, is a 404. The Rosters tab links to the workspace rosters page with this forum
// selected (`/courts/rosters?forum=<code>`, #435).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CourtNav } from '../../../../../../components/courts/court-nav.tsx';
import { CourtsOfflineBanner } from '../../../../../../components/courts/courts-offline-banner.tsx';
import { ForumHeader } from '../../../../../../components/courts/forum-header.tsx';
import { CourtsLoadError } from '../../../../../../components/courts/forum-list.tsx';
import { ForumTabs } from '../../../../../../components/courts/forum-tabs.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { forumCodeParam, loadCourtData } from '../../../../../../lib/court-forum-loader.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

interface ForumLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string; code: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('courts');
  return { title: t('metaTitle') };
}

export default async function ForumLayout({ children, params }: ForumLayoutProps) {
  const { slug, code: segment } = await params;
  // The workspace layout already checks membership; checking again keeps the shell safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const code = forumCodeParam(segment);

  const loaded = await loadCourtData(context, 'the forum', async (court, tx, workspaceId) => {
    const detail = await court.getForumDetail(tx, workspaceId, code);
    const index = await court.getCourtsIndex(tx, workspaceId);
    const entry =
      index.cities
        .flatMap((city) => city.courts.flatMap((group) => group.forums))
        .find((forum) => forum.code === detail.forum.code) ?? null;
    return { forum: detail.forum, entry };
  });
  if (loaded.kind === 'not-found') notFound();
  if (loaded.kind === 'denied') return <PermissionDeniedPage />;

  const t = await getTranslations('courts.detail');
  const back = (
    <Link
      href={`/w/${encodeURIComponent(slug)}/courts`}
      data-forum-back=""
      className="text-accent text-sm underline-offset-2 hover:underline"
    >
      {t('back')}
    </Link>
  );
  if (loaded.kind === 'error') {
    return (
      <div data-route="court-forum" className="flex flex-col gap-6">
        <CourtNav back={back} />
        <CourtsLoadError />
      </div>
    );
  }

  const { forum, entry } = loaded.value;
  return (
    <div data-route="court-forum" className="flex flex-col gap-6">
      <CourtsOfflineBanner />
      <CourtNav back={back} title={forum.court} />
      <ForumHeader
        forum={{
          code: forum.code,
          establishment: forum.establishment,
          seat: forum.seat,
          side: forum.side,
          languageProfile: forum.languageProfile,
          adapterLevel: forum.adapterLevel,
          workspaceId: forum.workspaceId,
        }}
        slug={slug}
        latestParse={entry?.latestParse ?? null}
        officialList={entry?.officialList ?? null}
      />
      <ForumTabs
        slug={slug}
        code={forum.code}
        rostersHref={`/w/${encodeURIComponent(slug)}/courts/rosters?forum=${encodeURIComponent(forum.code)}`}
      />
      <div data-slot="forum-tab-panel">{children}</div>
    </div>
  );
}
