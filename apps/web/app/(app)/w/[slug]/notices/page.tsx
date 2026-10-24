// `/w/[slug]/notices` (#588, D-048): the official notices matched to this workspace's forums and
// matters. Notices come from `listWorkspaceNotices` (`@causedeck/core/notices`), which runs in the
// member's workspace scope, so another workspace's matches never reach the page. Every role reads
// it (the nav item needs no permission); a FORBIDDEN from core renders permission-denied. Each
// notice shows its source and record date and links to the official notice.
//
// States: loading, error (`Could not load notices.` with `Try again`), empty and permission-denied.
// In development, `?__state=loading|error|denied` previews them.
import { EmptyState } from '@causedeck/ui/empty-state';
import { Megaphone } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  NoticeList,
  toNoticeView,
  type NoticeView,
} from '../../../../../components/notices/notice-list.tsx';
import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../lib/env.ts';
import type { WorkspaceContext } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../src/health.ts';

import NoticesLoading from './loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface NoticesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=loading|error|denied` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notices');
  return { title: t('metaTitle') };
}

type Loaded = { kind: 'notices'; notices: NoticeView[] } | { kind: 'denied' };

async function loadNotices(context: WorkspaceContext): Promise<Loaded> {
  try {
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { listWorkspaceNotices } = await import('@causedeck/core/notices');
    const actor = { workspaceId: context.workspace.id, userId: context.user.id };
    const rows = await inWorkspace(actor, (tx) => listWorkspaceNotices(tx, actor));
    return { kind: 'notices', notices: rows.map(toNoticeView) };
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
      if (error.code === 'FORBIDDEN') return { kind: 'denied' };
    }
    logger.error({ err: error }, 'notices page: could not load the notices');
    // The route error boundary renders `Could not load notices.` with `Try again`.
    throw error;
  }
}

export default async function NoticesPage({ params, searchParams }: NoticesPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const state = devState(query);
  if (state === 'loading') return <NoticesLoading />;
  if (state === 'error') throw new Error('Notices error state (dev toggle)');
  if (state === 'denied') return <PermissionDeniedPage />;

  const loaded = await loadNotices(context);
  if (loaded.kind === 'denied') return <PermissionDeniedPage />;
  const t = await getTranslations('notices');

  return (
    <div data-route="notices" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      {loaded.notices.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          icon={<Megaphone />}
          title={t('empty.title')}
          description={t('empty.hint')}
        />
      ) : (
        <NoticeList notices={loaded.notices} />
      )}
    </div>
  );
}
