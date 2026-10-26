// `/w/[slug]/today` (#493, #59): the court-day board. The bench-notice alerts (#496) and the
// live halls section (hall, item now, status, your item N away, estimated window) sits under it.
// It renders nothing while `court.live-tracking` is off or the member has no item listed today, and
// a failed read never breaks the page.
import type { LiveHall } from '@causedeck/core/court-day';

import {
  BenchNoticeAlerts,
  type BenchNoticeAlertView,
} from '../../../../../components/courts/bench-notice-alerts.tsx';
import { SurfaceHelp } from '../../../../../components/help/surface-help.tsx';
import { LiveHalls } from '../../../../../components/court-day/live-halls.tsx';
import {
  placeholderPage,
  type WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';
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

export default async function TodayPage(props: WorkspacePageProps) {
  // The placeholder renders first so its guards (membership, permission, dev states) run unchanged.
  const { base, board } = await renderBoard(props, 'today', Placeholder);
  const { slug } = await props.params;
  const live = await LiveHalls({ halls: await loadHalls(slug) });
  const bench = await loadBenchNotices(slug);
  return (
    <div className="flex flex-col gap-6">
      <SurfaceHelp slug={slug} surface="today" />
      {board ?? base}
      <BenchNoticeAlerts alerts={bench} slug={slug} />
      {live}
    </div>
  );
}
