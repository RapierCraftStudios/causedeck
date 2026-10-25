// `/w/[slug]/tomorrow` (#63): the tomorrow plan. Every appearance of the next court day with an
// assignee picker, unassigned and clashing items first, the engine's suggestions (proposals the
// owner accepts, never written by the read) and, for the owner, the live outcome strip.
//
// States: loading (route skeleton), error (`Try again`), denied, empty and offline (in the client
// view). `?__state=loading|error` previews the first two in development.
import { EmptyState } from '@causedeck/ui/empty-state';
import type { Suggestion } from '@causedeck/validators';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import { ShellOfflineBanner } from '../../../../../components/shell/offline-banner.tsx';
import { RouteSkeleton } from '../../../../../components/shell/route-skeleton.tsx';
import { isDev } from '../../../../../lib/env.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../src/health.ts';

import { DelegatePlan, OutcomesLiveStrip, type PlanRow } from '../_court-day/delegate-sheet.tsx';

import {
  acceptAllSuggestionsAction,
  assignAppearanceAction,
  outcomesLiveAction,
  type OutcomesLiveView,
} from './plan/actions.ts';

type SearchParams = Record<string, string | string[] | undefined>;

interface TomorrowPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('delegation');
  return { title: t('metaTitle') };
}

const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

/** The next calendar day in India, `yyyy-mm-dd`. */
function tomorrowIst(now: Date): string {
  return IST_DAY.format(new Date(now.getTime() + 24 * 60 * 60 * 1000));
}

/** Unassigned and clashing items first, then the rest in list order. */
function sortPlanRows(rows: readonly PlanRow[]): PlanRow[] {
  const rank = (r: PlanRow) => (r.flag === 'clash' ? 0 : r.flag === 'unassigned' ? 1 : 2);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }) => row);
}

async function loadPlan(
  workspaceId: string,
  userId: string,
  date: string,
  isOwner: boolean,
): Promise<{
  rows: PlanRow[];
  members: { id: string; name: string }[];
  outcomes: OutcomesLiveView | null;
}> {
  const runtime = await import('@causedeck/core/runtime');
  const { getCourtDay } = await import('@causedeck/core/court-day');
  const delegation = await import('@causedeck/core/delegation');
  const scope = { workspaceId, userId };
  const members = (await runtime.listMembersIn(scope)).map(({ memberId, name }) => ({
    id: memberId,
    name,
  }));
  const { day, suggestions, outcomes } = await runtime.inWorkspace(scope, async (tx) => {
    const day = await getCourtDay({ db: tx }, scope, { date, scope: 'workspace' });
    const suggestions = await delegation.suggestAssignments({ db: tx }, scope, { date });
    const live = isOwner ? await delegation.chamberOutcomesLive({ db: tx }, scope, { date }) : null;
    return { day, suggestions: suggestions.suggestions, outcomes: live };
  });
  const byListing = new Map<string, Suggestion>(suggestions.map((s) => [s.listingId, s]));
  const rows: PlanRow[] = day.complexes.flatMap((c) =>
    c.halls.flatMap((h) =>
      h.lists.flatMap((l) =>
        l.items.map((item): PlanRow => {
          const proposal = byListing.get(item.listingId);
          const clash = proposal !== undefined && proposal.kind !== 'unassigned';
          return {
            listingId: item.listingId,
            title: `${item.itemNo ?? '–'} · ${item.matterTitle}`,
            detail: `${item.caseLabel}${item.hallNo === null ? '' : ` · ${item.hallNo}`}`,
            assigneeId: item.assigneeMemberId,
            flag: clash ? 'clash' : item.assigneeMemberId === null ? 'unassigned' : undefined,
            capacity: item.capacity ?? 'arguing',
            ...(proposal === undefined
              ? {}
              : { suggestion: { memberId: proposal.memberId, reason: proposal.reason } }),
          };
        }),
      ),
    ),
  );
  return {
    rows: sortPlanRows(rows),
    members,
    outcomes:
      outcomes === null
        ? null
        : {
            members: outcomes.members.map(({ memberId, name, total, outcomesIn }) => ({
              memberId,
              name,
              total,
              outcomesIn,
            })),
            lastConfirmedAt: outcomes.lastConfirmedAt?.toISOString() ?? null,
          },
  };
}

export default async function TomorrowPage({ params, searchParams }: TomorrowPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!can(context.role, 'court_day.view_all')) return <PermissionDeniedPage />;

  const preview = isDev() ? query.__state : undefined;
  if (preview === 'loading') return <RouteSkeleton />;

  const t = await getTranslations('delegation');
  const canAssign = can(context.role, 'appearance.assign');
  const date = tomorrowIst(new Date());
  let plan: Awaited<ReturnType<typeof loadPlan>>;
  try {
    if (preview === 'error') throw new Error('Tomorrow plan error state (dev toggle)');
    plan = await loadPlan(context.workspace.id, context.user.id, date, context.role === 'owner');
  } catch (error) {
    if (preview !== 'error') logger.error({ err: error }, 'tomorrow plan: could not load');
    return (
      <div role="alert" data-pattern-state="error" className="flex flex-col gap-2">
        <p>{t('error')}</p>
        <a href="" className="underline">
          {t('retry')}
        </a>
      </div>
    );
  }

  return (
    <div data-route="tomorrow" className="flex flex-col gap-6">
      <ShellOfflineBanner />
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      {plan.outcomes === null ? null : (
        <OutcomesLiveStrip
          workspaceId={context.workspace.id}
          date={date}
          initial={plan.outcomes}
          poll={outcomesLiveAction}
        />
      )}
      {plan.rows.length === 0 ? (
        <EmptyState data-pattern-state="empty" title={t('empty')} />
      ) : (
        <DelegatePlan
          workspaceId={context.workspace.id}
          rows={plan.rows}
          members={plan.members}
          canAssign={canAssign}
          actions={{ assign: assignAppearanceAction, acceptAll: acceptAllSuggestionsAction }}
        />
      )}
    </div>
  );
}
