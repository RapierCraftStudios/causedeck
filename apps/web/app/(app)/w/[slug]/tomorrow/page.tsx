// `/w/[slug]/tomorrow` (#59, #63): the court-day board for the next IST day, with the tomorrow
// plan (#63) as a section under it. The plan lists every appearance of the next court day with an
// assignee picker, unassigned and clashing items first, the engine's suggestions (proposals the
// owner accepts, never written by the read) and, for the owner, the live outcome strip.
//
// The plan needs `court_day.view_all`; a member without it sees the board alone. States: the
// board's own, plus the plan's error (`Try again`), empty and offline. `?__state=loading|error`
// shows the placeholder page's preview of those states in development, as before the board.
import { EmptyState } from '@causedeck/ui/empty-state';
import type { Suggestion } from '@causedeck/validators';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ShellOfflineBanner } from '../../../../../components/shell/offline-banner.tsx';
import {
  placeholderPage,
  type WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../src/health.ts';

import { renderBoard } from '../_court-day/render-board.tsx';
import { DelegatePlan, OutcomesLiveStrip, type PlanRow } from '../_court-day/delegate-sheet.tsx';

import {
  acceptAllSuggestionsAction,
  assignAppearanceAction,
  outcomesLiveAction,
  type OutcomesLiveView,
} from './plan/actions.ts';

const Placeholder = placeholderPage('tomorrow');

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

export default async function TomorrowPage(props: WorkspacePageProps) {
  // The placeholder's guards run first (membership, flag, dev states); the board replaces its body.
  const { base, board } = await renderBoard(props, 'tomorrow', Placeholder);
  if (board === null) return base;
  const { slug } = await props.params;
  const context = await getWorkspaceContext(slug);
  if (!context || !can(context.role, 'court_day.view_all')) return board;

  const t = await getTranslations('delegation');
  const canAssign = can(context.role, 'appearance.assign');
  const date = tomorrowIst(new Date());
  let plan: Awaited<ReturnType<typeof loadPlan>>;
  try {
    plan = await loadPlan(context.workspace.id, context.user.id, date, context.role === 'owner');
  } catch (error) {
    logger.error({ err: error }, 'tomorrow plan: could not load');
    return (
      <div className="flex flex-col gap-6">
        {board}
        <div role="alert" data-pattern-state="error" className="flex flex-col gap-2">
          <p>{t('error')}</p>
          <a href="" className="underline">
            {t('retry')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {board}
      <section
        data-section="tomorrow-plan"
        aria-labelledby="tomorrow-plan-title"
        className="flex flex-col gap-4"
      >
        <ShellOfflineBanner />
        <header className="flex flex-col gap-1">
          <h2 id="tomorrow-plan-title" className="font-serif text-xl font-medium">
            {t('title')}
          </h2>
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
      </section>
    </div>
  );
}
