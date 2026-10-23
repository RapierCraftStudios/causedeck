// `/w/[slug]/courts/rosters/import` (#436, part 3 of #391): owners and advocates upload a forum's
// sitting-arrangements PDF, review the parsed halls and confirm the roster, through the part 1
// actions (`../actions.ts`). `?forum=<code>` (the rosters page's `Import roster` sends it) picks the
// forum; without one, or with a code not in the courts index, the page asks for the forum first.
// One read in this workspace's RLS scope gives the courts index (`listForums`) and the rosters page
// model (`getRostersPage`), so the review knows the forum's id and whether it already has an
// active roster (confirming supersedes it, so a Dialog asks first). Clerks and viewers get
// permission-denied: the rosters page is their read-only view. In development,
// `?__state=loading|error|denied` previews those states.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CourtNav } from '../../../../../../../components/courts/court-nav.tsx';
import { CourtsOfflineBanner } from '../../../../../../../components/courts/courts-offline-banner.tsx';
import {
  RosterImportForumSelect,
  RosterImportReview,
} from '../../../../../../../components/courts/roster-import-review.tsx';
import { RostersLoadError } from '../../../../../../../components/courts/roster-table.tsx';
import { PermissionDeniedPage } from '../../../../../../../components/shell/permission-denied-page.tsx';
import { loadCourtData } from '../../../../../../../lib/court-forum-loader.ts';
import { isDev } from '../../../../../../../lib/env.ts';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';
import { confirmRosterImportAction, previewRosterImportAction } from '../actions.ts';
import RostersLoading from '../loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface RosterImportPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Today in India (YYYY-MM-DD), the day the rosters page model is read for. */
function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('courtsRosters.import');
  return { title: t('metaTitle') };
}

export default async function RosterImportPage({ params, searchParams }: RosterImportPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const state = isDev() ? first(query.__state) : undefined;
  if (state === 'loading') return <RostersLoading />;
  if (state === 'error') throw new Error('Roster import error state (dev toggle)');
  if (state === 'denied' || !can(context.role, 'workspace.manage')) {
    return <PermissionDeniedPage />;
  }

  const t = await getTranslations('courtsRosters.import');
  const requested = first(query.forum);
  const back = (
    <Link
      href={`/w/${encodeURIComponent(slug)}/courts/rosters${
        requested === undefined ? '' : `?forum=${encodeURIComponent(requested)}`
      }`}
      data-roster-import-back=""
      className="text-accent text-sm underline-offset-2 hover:underline"
    >
      {t('back')}
    </Link>
  );
  const header = <CourtNav back={back} title={t('title')} />;

  const loaded = await loadCourtData(
    context,
    'the roster import',
    async (court, tx, workspaceId) => {
      const forums = await court.listForums(tx, workspaceId);
      const rosters = await court.getRostersPage(
        tx,
        { workspaceId, userId: context.user.id },
        { on: todayInIndia() },
      );
      return { forums, rosters };
    },
  );
  if (loaded.kind === 'denied') return <PermissionDeniedPage />;
  if (loaded.kind !== 'ok') {
    return (
      <div data-route="courts-roster-import" className="flex flex-col gap-6">
        {header}
        <RostersLoadError />
      </div>
    );
  }

  const { forums, rosters } = loaded.value;
  const forum = forums.find((f) => f.code === requested);
  let body;
  if (forum === undefined) {
    body = (
      <RosterImportForumSelect
        slug={slug}
        forums={forums.map((f) => ({ code: f.code, court: f.court, seat: f.seat }))}
      />
    );
  } else {
    const group = rosters.forums.find((g) => g.forum.id === forum.id);
    body = (
      <RosterImportReview
        slug={slug}
        workspaceId={context.workspace.id}
        forum={{ id: forum.id, code: forum.code, court: forum.court }}
        hasActiveRoster={group?.rosters.some((r) => r.status === 'active') ?? false}
        preview={previewRosterImportAction}
        confirm={confirmRosterImportAction}
      />
    );
  }

  return (
    <div data-route="courts-roster-import" className="flex flex-col gap-6">
      <CourtsOfflineBanner />
      {header}
      {body}
    </div>
  );
}
