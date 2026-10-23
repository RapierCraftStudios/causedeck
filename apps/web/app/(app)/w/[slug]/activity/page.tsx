// `/w/[slug]/activity` (#232, #26 part 6, #49): the workspace Activity page, with two views. The
// default is the automation feed (#49): what CauseDeck did, newest first, with a 7-day Undo
// (`listActivities`, `@causedeck/core/automation`; undo and reassign are the engine's). The second,
// `?tab=security`, is the security and audit feed (#26): it reads `queryAudit`
// (`@causedeck/core/audit`), which checks `audit.read` (owners; advocates unless the workspace
// turned it off) and keeps other workspaces' events out through `withWorkspace`; members are
// loaded only to name actors and targets. Both only read through core, which scopes to the
// signed-in workspace.
//
// States: loading (skeleton rows while the feed streams in), error (`Could not load activity.` with
// `Try again`), permission-denied, empty and offline (in the client view). `?__state=loading|error`
// previews the first two in development, like the members page.
import type { ActivityPage } from '@causedeck/core/automation';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ShellOfflineBanner } from '../../../../../components/shell/offline-banner.tsx';
import { isDev } from '../../../../../lib/env.ts';
import type { WorkspaceContext } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../src/health.ts';

import { searchMattersAction } from '../matters/actions.ts';

import {
  loadMoreActivitiesAction,
  loadMoreAuditAction,
  previewActivityUndoAction,
  reassignFeedCaptureAction,
  undoFeedActivityAction,
  undoCaptureAction,
  verifyAuditEventAction,
} from './actions.ts';
import {
  AuditDenied,
  AuditError,
  AuditFeed,
  AuditSkeleton,
  type AuditFeedPage,
} from './audit-feed.tsx';
import {
  ActivityDenied,
  ActivityError,
  ActivityFeed,
  ActivitySkeleton,
} from '../../../../../components/activity/activity-feed.tsx';
import {
  feedBounds,
  parseFeedFilters,
  type FeedFilters,
} from '../../../../../components/activity/feed-params.ts';

import { filterBounds, parseAuditFilters, type AuditFilterValues } from './filter-params.ts';
import type { AuditMember } from './filters.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface ActivityPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?__state=loading|error` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('activity');
  return { title: t('metaTitle') };
}

type Loaded =
  | { kind: 'feed'; page: AuditFeedPage; members: AuditMember[]; isOwner: boolean }
  | { kind: 'denied' };

async function loadFeed(context: WorkspaceContext, filters: AuditFilterValues): Promise<Loaded> {
  const { listMembersIn, queryAuditFeed } = await import('@causedeck/core/runtime');
  const workspaceId = context.workspace.id;
  const userId = context.user.id;
  const bounds = filterBounds(filters);
  let page: AuditFeedPage;
  try {
    page = await queryAuditFeed(
      { workspaceId, userId },
      {
        ...(bounds.from === undefined ? {} : { from: new Date(bounds.from) }),
        ...(bounds.to === undefined ? {} : { to: new Date(bounds.to) }),
        ...(bounds.actorUserId === undefined ? {} : { actorUserId: bounds.actorUserId }),
        ...(bounds.actionGroup === undefined ? {} : { actionGroup: bounds.actionGroup }),
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
      if (error.code === 'FORBIDDEN') return { kind: 'denied' };
    }
    throw error;
  }
  const members = await listMembersIn({ workspaceId, userId });
  return {
    kind: 'feed',
    page,
    members: members.map(({ memberId, userId: id, name }) => ({ memberId, userId: id, name })),
    isOwner: context.role === 'owner',
  };
}

async function FeedSection({
  context,
  filters,
  eventId,
  failOnPurpose,
}: {
  context: WorkspaceContext;
  filters: AuditFilterValues;
  eventId: string | undefined;
  failOnPurpose: boolean;
}) {
  let loaded: Loaded;
  try {
    if (failOnPurpose) throw new Error('Activity error state (dev toggle)');
    loaded = await loadFeed(context, filters);
  } catch (error) {
    if (!failOnPurpose) logger.error({ err: error }, 'activity page: could not load audit events');
    return <AuditError />;
  }
  if (loaded.kind === 'denied') return <AuditDenied />;
  return (
    <AuditFeed
      workspace={{ id: context.workspace.id, slug: context.workspace.slug }}
      initialPage={loaded.page}
      members={loaded.members}
      isOwner={loaded.isOwner}
      filters={filters}
      initialEventId={eventId}
      actions={{ loadMore: loadMoreAuditAction, verifyEvent: verifyAuditEventAction }}
    />
  );
}

type LoadedActivities =
  | {
      kind: 'feed';
      page: ActivityPage;
      members: { userId: string; name: string }[];
    }
  | { kind: 'denied' };

async function loadActivities(
  context: WorkspaceContext,
  filters: FeedFilters,
): Promise<LoadedActivities> {
  const { listActivitiesFor, listMembersIn } = await import('@causedeck/core/runtime');
  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const { from, to, ...rest } = feedBounds(filters);
  let page: ActivityPage;
  try {
    page = await listActivitiesFor(scope, {
      ...rest,
      ...(from === undefined ? {} : { from: new Date(from) }),
      ...(to === undefined ? {} : { to: new Date(to) }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
      if (error.code === 'FORBIDDEN') return { kind: 'denied' };
    }
    throw error;
  }
  const members = await listMembersIn(scope);
  return { kind: 'feed', page, members: members.map(({ userId, name }) => ({ userId, name })) };
}

async function ActivitySection({
  context,
  filters,
  failOnPurpose,
}: {
  context: WorkspaceContext;
  filters: FeedFilters;
  failOnPurpose: boolean;
}) {
  let loaded: LoadedActivities;
  try {
    if (failOnPurpose) throw new Error('Activity error state (dev toggle)');
    loaded = await loadActivities(context, filters);
  } catch (error) {
    if (!failOnPurpose) logger.error({ err: error }, 'activity page: could not load activities');
    return <ActivityError />;
  }
  if (loaded.kind === 'denied') return <ActivityDenied />;
  return (
    <ActivityFeed
      // A new filter set is a new feed: the client state starts from the page it was given.
      key={JSON.stringify(filters)}
      workspace={{ id: context.workspace.id, slug: context.workspace.slug }}
      initialPage={loaded.page}
      members={loaded.members}
      currentUserId={context.user.id}
      role={context.role}
      filters={filters}
      nowIso={new Date().toISOString()}
      actions={{
        loadMore: loadMoreActivitiesAction,
        preview: previewActivityUndoAction,
        undo: undoFeedActivityAction,
        undoCapture: undoCaptureAction,
        reassign: reassignFeedCaptureAction,
        searchMatters: searchMattersAction,
      }}
    />
  );
}

export default async function ActivityPage({ params, searchParams }: ActivityPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('activity');
  const state = devState(query);
  const tab =
    (Array.isArray(query.tab) ? query.tab[0] : query.tab) === 'security' ? 'security' : 'feed';
  const event = Array.isArray(query.event) ? query.event[0] : query.event;
  const eventId = event && UUID.test(event) ? event : undefined;
  const href = `/w/${encodeURIComponent(slug)}/activity`;
  const tabClass =
    'focus-visible:outline-ring -mb-px border-b-2 pb-2 text-sm font-medium outline-offset-2 focus-visible:outline-2';

  return (
    <div data-route="activity" className="flex flex-col gap-6">
      <ShellOfflineBanner />
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">
          {t('description', { workspace: context.workspace.name })}
        </p>
      </header>
      <nav aria-label={t('tabs.label')} className="border-line flex gap-4 border-b">
        <a
          href={href}
          aria-current={tab === 'feed' ? 'page' : undefined}
          className={`${tabClass} ${tab === 'feed' ? 'border-accent' : 'text-ink-muted border-transparent'}`}
        >
          {t('tabs.feed')}
        </a>
        <a
          href={`${href}?tab=security`}
          aria-current={tab === 'security' ? 'page' : undefined}
          className={`${tabClass} ${tab === 'security' ? 'border-accent' : 'text-ink-muted border-transparent'}`}
        >
          {t('tabs.security')}
        </a>
      </nav>
      {tab === 'security' ? (
        state === 'loading' ? (
          <AuditSkeleton />
        ) : (
          <Suspense fallback={<AuditSkeleton />}>
            <FeedSection
              context={context}
              filters={parseAuditFilters(query)}
              eventId={eventId}
              failOnPurpose={state === 'error'}
            />
          </Suspense>
        )
      ) : state === 'loading' ? (
        <ActivitySkeleton />
      ) : (
        <Suspense fallback={<ActivitySkeleton />}>
          <ActivitySection
            context={context}
            filters={parseFeedFilters(query)}
            failOnPurpose={state === 'error'}
          />
        </Suspense>
      )}
    </div>
  );
}
