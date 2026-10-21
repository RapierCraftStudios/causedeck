// `/w/[slug]/courts` (#399, #42): the courts index. Forums come from `getCourtsIndex`
// (`@causedeck/core/court`), which runs in this workspace's RLS scope, so other workspaces' parse
// runs and custom forums never reach the page. Every role reads it (the nav item needs no
// permission); a FORBIDDEN from core renders permission-denied. Deep links are plain new-window
// anchors: nothing here fetches or frames a court page. Owners and advocates (`workspace.manage`)
// also get `Add forum` (#402), which adds a workspace-owned A0 forum through `./actions.ts`; its
// dialog loads in its own chunk (`AddForum`, #427) to keep the route within its JS budget.
//
// States: loading (card skeletons), error (`Could not load courts.` with `Try again`), empty,
// offline (`Showing saved court information`) and permission-denied. `?__state=loading|error`
// previews the first two in development.
import type { CourtsIndex } from '@causedeck/core/court';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Landmark } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AddForum } from '../../../../../components/courts/add-forum.tsx';
import { CourtNav } from '../../../../../components/courts/court-nav.tsx';
import { CourtsOfflineBanner } from '../../../../../components/courts/courts-offline-banner.tsx';
import { CourtsLoadError, ForumList } from '../../../../../components/courts/forum-list.tsx';
import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../lib/env.ts';
import { can, type WorkspaceContext } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../src/health.ts';

import { createWorkspaceForumAction } from './actions.ts';
import CourtsLoading from './loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface CourtsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=loading|error` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('courts');
  return { title: t('metaTitle') };
}

/** Every code in the index, so the add-forum dialog blocks a taken one before asking the server. */
function indexCodes(index: CourtsIndex): string[] {
  return [
    ...index.cities.flatMap((city) =>
      city.courts.flatMap((court) => court.forums.map((forum) => forum.code)),
    ),
    ...index.disabled.map((forum) => forum.code),
  ];
}

type Loaded = { kind: 'index'; index: CourtsIndex } | { kind: 'denied' } | { kind: 'error' };

async function loadIndex(context: WorkspaceContext): Promise<Loaded> {
  try {
    // One at a time, not in a Promise.all: concurrent imports race the test mocks.
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { getCourtsIndex } = await import('@causedeck/core/court');
    const workspaceId = context.workspace.id;
    const index = await inWorkspace({ workspaceId, userId: context.user.id }, (tx) =>
      getCourtsIndex(tx, workspaceId),
    );
    return { kind: 'index', index };
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
      if (error.code === 'FORBIDDEN') return { kind: 'denied' };
    }
    logger.error({ err: error }, 'courts page: could not load the courts index');
    return { kind: 'error' };
  }
}

export default async function CourtsPage({ params, searchParams }: CourtsPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const state = devState(query);
  if (state === 'loading') return <CourtsLoading />;
  if (state === 'error') throw new Error('Courts error state (dev toggle)');

  const loaded = await loadIndex(context);
  if (loaded.kind === 'denied') return <PermissionDeniedPage />;
  const t = await getTranslations('courts');

  const addForum =
    loaded.kind === 'index' && can(context.role, 'workspace.manage') ? (
      <AddForum
        workspaceId={context.workspace.id}
        takenCodes={indexCodes(loaded.index)}
        action={createWorkspaceForumAction}
      />
    ) : null;

  let body;
  if (loaded.kind === 'error') {
    body = <CourtsLoadError />;
  } else if (loaded.index.cities.length === 0 && loaded.index.disabled.length === 0) {
    body = (
      <EmptyState
        data-pattern-state="empty"
        icon={<Landmark />}
        title={t('empty.title')}
        description={t('empty.hint')}
      />
    );
  } else {
    body = <ForumList index={loaded.index} slug={slug} />;
  }

  return (
    <div data-route="courts" className="flex flex-col gap-6">
      <CourtsOfflineBanner />
      <CourtNav />
      {addForum}
      {body}
    </div>
  );
}
