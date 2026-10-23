// `/w/[slug]/settings/integrations/calendar` (#53; PRD CA-5): the private ICS feed (create, rotate,
// revoke, party names, scope) and the calendar-file import with its review. Behind the
// `capture.ics-feed` flag (a dark feature is a plain 404) and `matter.read`; members who cannot read
// matters get the permission-denied page. The feed card never sees the token: only its status.
// `?capture=<id>` opens the review of one import. Read on the workspace-scoped transaction
// (`inWorkspace`).
//
// States: empty (no feed yet), loading (skeleton cards), error (`Could not load the calendar
// settings.` with `Try again`), offline (the settings banner; the controls disable with the reason)
// and permission-denied. `?__state=loading|error` previews the first two in development.
import { can } from '@causedeck/auth/policy';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PermissionDeniedPage } from '../../../../../../../components/shell/permission-denied-page.tsx';
import {
  CalendarSkeleton,
  FeedCard,
} from '../../../../../../../components/settings/calendar/feed-card.tsx';
import { ImportCard } from '../../../../../../../components/settings/calendar/import-card.tsx';
import {
  ImportReview,
  type ReviewRowView,
} from '../../../../../../../components/settings/calendar/import-review.tsx';
import { isDev, serverEnv } from '../../../../../../../lib/env.ts';
import { requireWorkspaceFlag } from '../../../../../../../lib/flags.ts';
import { parseMatterListParams } from '../../../../../../../lib/matters/list-params.ts';
import { loadMatterList } from '../../../../../../../lib/matters/graph-deps.ts';
import type { WorkspaceContext } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../../src/health.ts';

import {
  confirmCalendarEventAction,
  createCalendarFeedAction,
  noteCalendarEventAction,
  revokeCalendarFeedAction,
  rotateCalendarFeedAction,
  setCalendarFeedPartiesAction,
  skipCalendarEventAction,
} from './actions.ts';
import { CalendarError } from './error.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface CalendarPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('calendar');
  return { title: t('metaTitle') };
}

async function load(context: WorkspaceContext, captureId: string | undefined) {
  // One at a time, not in a Promise.all: concurrent imports race the test mocks.
  const { inWorkspace } = await import('@causedeck/core/runtime');
  const calendar = await import('@causedeck/core/calendar');
  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const status = await inWorkspace(scope, (tx) => calendar.getFeedStatus(tx, scope));
  const review =
    captureId === undefined
      ? null
      : await inWorkspace(scope, (tx) => calendar.getImportReview({ db: tx, ...scope }, captureId));
  return { status, review, version: calendar.CALENDAR_DISCLOSURE_VERSION };
}

async function CalendarSection({
  context,
  captureId,
  state,
}: {
  context: WorkspaceContext;
  captureId: string | undefined;
  state: string | undefined;
}) {
  let data: Awaited<ReturnType<typeof load>>;
  try {
    if (state === 'error') throw new Error('Calendar error state (dev toggle)');
    data = await load(context, captureId);
  } catch (error) {
    if (state !== 'error') logger.error({ err: error }, 'calendar page: could not load');
    return <CalendarError />;
  }
  const t = await getTranslations('calendar');
  const slug = context.workspace.slug;
  const base = `/w/${slug}/settings/integrations/calendar`;
  const appUrl = serverEnv().APP_URL.replace(/\/$/, '');

  let matters: { id: string; title: string }[] = [];
  if (data.review?.rows.some((row) => row.matterId === null)) {
    const list = await loadMatterList(context, { ...parseMatterListParams({}), limit: 50 });
    if (list.kind === 'page') matters = list.page.items.map((m) => ({ id: m.id, title: m.title }));
  }
  const rows: ReviewRowView[] = (data.review?.rows ?? []).map((row) => ({
    uid: row.uid,
    status: row.status,
    summary: row.summary,
    location: row.location,
    eventDate: row.eventDate,
    eventTime: row.eventTime,
    matterId: row.matterId,
    preview: row.preview,
  }));

  return (
    <>
      {data.review === null ? null : (
        <ImportReview
          workspaceId={context.workspace.id}
          captureId={data.review.captureId}
          captureStatus={data.review.captureStatus}
          summary={data.review.summary}
          rows={rows}
          matters={matters}
          actions={{
            confirm: confirmCalendarEventAction,
            skip: skipCalendarEventAction,
            note: noteCalendarEventAction,
          }}
        />
      )}
      <FeedCard
        workspaceId={context.workspace.id}
        status={data.status}
        isOwner={context.role === 'owner'}
        disclosureVersion={data.version}
        masked={`${appUrl}/api/ics/••••••••••••`}
        actions={{
          create: createCalendarFeedAction,
          rotate: rotateCalendarFeedAction,
          revoke: revokeCalendarFeedAction,
          setParties: setCalendarFeedPartiesAction,
        }}
      />
      <ImportCard workspaceId={context.workspace.id} reviewHrefBase={base} />
      <p className="sr-only">{t('title')}</p>
    </>
  );
}

export default async function CalendarPage({ params, searchParams }: CalendarPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('capture.ics-feed', context);
  const actor = { userId: context.user.id, workspaceId: context.workspace.id, role: context.role };
  if (!can(actor, 'matter.read').allow) return <PermissionDeniedPage />;
  const t = await getTranslations('calendar');
  const state = isDev() ? first(query.__state) : undefined;
  const capture = first(query.capture);
  const captureId = capture !== undefined && UUID.test(capture) ? capture : undefined;

  return (
    <div data-route="settings-calendar" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      {state === 'loading' ? (
        <CalendarSkeleton />
      ) : (
        <Suspense fallback={<CalendarSkeleton />}>
          <CalendarSection context={context} captureId={captureId} state={state} />
        </Suspense>
      )}
    </div>
  );
}
