// `/w/[slug]/today` (#493, #59): the court-day board. The bench-notice alerts (#496) and the
// live halls section (hall, item now, status, your item N away, estimated window) sits under it.
// It renders nothing while `court.live-tracking` is off or the member has no item listed today, and
// a failed read never breaks the page.
import type { LiveHall } from '@causedeck/core/court-day';

import {
  BenchNoticeAlerts,
  type BenchNoticeAlertView,
} from '../../../../../components/courts/bench-notice-alerts.tsx';
import { LiveHalls } from '../../../../../components/court-day/live-halls.tsx';
import {
  placeholderPage,
  type WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';
import { LoadPulseCard } from '../_pov/load-pulse-card.tsx';
import { renderBoard } from '../_court-day/render-board.tsx';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../src/health.ts';

const Placeholder = placeholderPage('today');

async function loadHalls(slug: string): Promise<LiveHall[]> {
  try {
    const context = await getWorkspaceContext(slug);
    if (!context) return [];
    const { db } = await import('@causedeck/core/runtime');
    const { getLiveHalls } = await import('@causedeck/core/court-day');
    return await getLiveHalls(
      { db },
      { workspaceId: context.workspace.id, userId: context.user.id },
    );
  } catch (error) {
    logger.error({ err: error }, 'today page: could not load live halls');
    return [];
  }
}

const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

/** Bench-notice alerts for today's and the upcoming court days (#496); a failed read shows none. */
async function loadBenchNotices(slug: string): Promise<BenchNoticeAlertView[]> {
  try {
    const context = await getWorkspaceContext(slug);
    if (!context) return [];
    const { db } = await import('@causedeck/core/runtime');
    const { listBenchNoticeAlerts } = await import('@causedeck/core/court');
    return await listBenchNoticeAlerts(
      db,
      { workspaceId: context.workspace.id, userId: context.user.id },
      { from: istDay.format(new Date()) },
    );
  } catch (error) {
    logger.error({ err: error }, 'today page: could not load bench-notice alerts');
    return [];
  }
}

/** The weekly pulse is due for this member (#86); a failed read shows no card. */
async function loadPulseDue(slug: string): Promise<string | null> {
  try {
    const context = await getWorkspaceContext(slug);
    if (!context) return null;
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { dueForPulse } = await import('@causedeck/core/pov');
    const actor = { workspaceId: context.workspace.id, userId: context.user.id };
    const due = await inWorkspace(actor, (tx) => dueForPulse({ db: tx }, actor));
    return due ? actor.workspaceId : null;
  } catch (error) {
    logger.error({ err: error }, 'today page: could not read the weekly pulse');
    return null;
  }
}

export default async function TodayPage(props: WorkspacePageProps) {
  // The placeholder renders first so its guards (membership, permission, dev states) run unchanged.
  const { base, board } = await renderBoard(props, 'today', Placeholder);
  const { slug } = await props.params;
  const live = await LiveHalls({ halls: await loadHalls(slug) });
  const bench = await loadBenchNotices(slug);
  const pulse = await loadPulseDue(slug);
  if (live === null && bench.length === 0 && pulse === null) return board ?? base;
  return (
    <div className="flex flex-col gap-6">
      {board ?? base}
      <BenchNoticeAlerts alerts={bench} slug={slug} />
      {live}
      {pulse === null ? null : <LoadPulseCard workspaceId={pulse} />}
    </div>
  );
}
