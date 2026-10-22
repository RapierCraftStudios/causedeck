// `/w/[slug]/courts/rosters` (#435, part 2 of #391): the workspace's bench rosters. One
// `getRostersPage` read (`@causedeck/core/court`, #434) in this workspace's RLS scope gives the
// forums with roster versions, entry counts, the roster in force today (Asia/Kolkata) and its halls,
// and the open bench-change alerts on matters the member may read. `?forum=<code>` selects a forum
// (the forum detail's Rosters tab links here with it); an unknown code falls back to the first.
// Layout: at 360 px a forum `Select` and stacked roster cards; from 768 px a 240 px forum rail and
// the rosters; from 1280 px a 320 px alerts panel on the right. Owners and advocates
// (`workspace.manage`, as the import actions) get `Import roster`, which opens the import review
// (#436); clerks and viewers read the same list with a read-only note. Court-published composition
// only: no judge is grouped, counted or ranked (PX-9, ME-6).
//
// States: loading (skeleton rows), error (`Could not load rosters.` with `Try again`), empty
// (`No roster imported yet.`), offline (the saved-information banner; import disabled) and
// permission-denied (a FORBIDDEN from core). In development, `?__state=loading|error|denied`
// previews the first two and permission-denied, so the e2e suite can drive all five.
import type { RostersPage, RostersPageForum } from '@causedeck/core/court';
import { EmptyState } from '@causedeck/ui/empty-state';
import { ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  BenchChangeBanner,
  type BenchChangeItem,
} from '../../../../../../components/courts/bench-change-banner.tsx';
import { CourtNav } from '../../../../../../components/courts/court-nav.tsx';
import { CourtsOfflineBanner } from '../../../../../../components/courts/courts-offline-banner.tsx';
import { RosterForumPicker } from '../../../../../../components/courts/roster-forum-picker.tsx';
import {
  RosterImportLink,
  RostersLoadError,
  RosterTable,
} from '../../../../../../components/courts/roster-table.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { loadCourtData } from '../../../../../../lib/court-forum-loader.ts';
import { isDev } from '../../../../../../lib/env.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import RostersLoading from './loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface RostersPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `?__state=loading|error|denied` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  return isDev() ? first(searchParams.__state) : undefined;
}

/** Today in India (YYYY-MM-DD): rosters take effect on Indian court days. */
function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('courtsRosters');
  return { title: t('metaTitle') };
}

function alertItems(alerts: RostersPage['alerts'], forumId: string): BenchChangeItem[] {
  return alerts
    .filter((alert) => alert.forumId === forumId)
    .map((alert) => ({
      alertId: alert.alertId,
      matterId: alert.matterId,
      matterTitle: alert.matterTitle,
      effectiveFrom: alert.effectiveFrom,
      oldBench: alert.oldBench === null ? null : { label: alert.oldBench.label },
      newBench: { label: alert.newBench.label },
    }));
}

function rosterCards(group: RostersPageForum) {
  return group.rosters.map((roster) => ({
    id: roster.id,
    version: roster.version,
    status: roster.status,
    effectiveFrom: roster.effectiveFrom,
    effectiveTo: roster.effectiveTo,
    entryCount: roster.entryCount,
  }));
}

export default async function CourtsRostersPage({ params, searchParams }: RostersPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const state = devState(query);
  if (state === 'loading') return <RostersLoading />;
  if (state === 'error') throw new Error('Rosters error state (dev toggle)');
  if (state === 'denied') return <PermissionDeniedPage />;

  const loaded = await loadCourtData(context, 'the rosters', (court, tx, workspaceId) =>
    court.getRostersPage(tx, { workspaceId, userId: context.user.id }, { on: todayInIndia() }),
  );
  if (loaded.kind === 'denied') return <PermissionDeniedPage />;

  const t = await getTranslations('courtsRosters');
  const back = (
    <Link
      href={`/w/${encodeURIComponent(slug)}/courts`}
      data-rosters-back=""
      className="text-accent text-sm underline-offset-2 hover:underline"
    >
      {t('back')}
    </Link>
  );
  const header = <CourtNav back={back} title={t('title')} />;

  if (loaded.kind !== 'ok') {
    return (
      <div data-route="courts-rosters" className="flex flex-col gap-6">
        {header}
        <RostersLoadError />
      </div>
    );
  }

  const page = loaded.value;
  const requested = first(query.forum);
  const group = page.forums.find((f) => f.forum.code === requested) ?? page.forums[0];
  const canImport = can(context.role, 'workspace.manage');
  const importHref = `/w/${encodeURIComponent(slug)}/courts/rosters/import${
    group === undefined ? '' : `?forum=${encodeURIComponent(group.forum.code)}`
  }`;

  const actions = (
    <div data-slot="rosters-actions" className="flex flex-wrap items-center gap-3">
      <p className="text-ink-muted max-w-prose flex-1 text-sm">{t('description')}</p>
      {canImport ? (
        <RosterImportLink href={importHref} />
      ) : (
        <p data-rosters-read-only="" className="text-ink-muted text-xs">
          {t('readOnly')}
        </p>
      )}
    </div>
  );

  let body;
  if (group === undefined) {
    body = (
      <EmptyState
        data-pattern-state="empty"
        icon={<ScrollText />}
        title={t('empty.title')}
        description={t('empty.hint')}
      />
    );
  } else {
    body = (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        <div className="md:row-span-2">
          <RosterForumPicker
            slug={slug}
            selected={group.forum.code}
            forums={page.forums.map((f) => ({
              code: f.forum.code,
              court: f.forum.court,
              seat: f.forum.seat,
            }))}
          />
        </div>
        <BenchChangeBanner
          slug={slug}
          alerts={alertItems(page.alerts, group.forum.id)}
          showEmpty
          className="md:col-start-2 xl:col-start-3 xl:row-start-1"
        />
        <section
          aria-label={group.forum.court}
          data-roster-forum-panel={group.forum.code}
          className="md:col-start-2 xl:row-start-1"
        >
          <RosterTable
            rosters={rosterCards(group)}
            activeRosterId={group.activeRosterId}
            halls={group.halls.map((hall) => ({
              entryId: hall.entryId,
              hallNo: hall.hallNo,
              portfolioText: hall.portfolioText,
              benchLabel: hall.bench.label,
            }))}
          />
        </section>
      </div>
    );
  }

  return (
    <div data-route="courts-rosters" className="flex flex-col gap-6">
      <CourtsOfflineBanner />
      {header}
      {actions}
      {body}
    </div>
  );
}
