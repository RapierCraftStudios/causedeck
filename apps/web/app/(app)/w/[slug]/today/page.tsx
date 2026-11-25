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
import { LoadPulseCard } from '../_pov/load-pulse-card.tsx';
import { renderBoard } from '../_court-day/render-board.tsx';
import type { WorkspaceContext } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../src/health.ts';

const Placeholder = placeholderPage('today');

async function loadHalls(context: WorkspaceContext): Promise<LiveHall[]> {
  try {
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
async function loadBenchNotices(context: WorkspaceContext): Promise<BenchNoticeAlertView[]> {
  try {
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
async function loadPulseDue(context: WorkspaceContext): Promise<string | null> {
  try {
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
  // #1193: one workspace context, the loaders in parallel, each one's duration on one timing line.
  const context = await getWorkspaceContext(slug);
  const timings: Record<string, number> = {};
  const started = performance.now();
  const timed = async <T,>(name: string, run: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await run();
    } finally {
      timings[name] = Math.round(performance.now() - start);
    }
  };
  const [halls, bench, pulse] =
    context === null
      ? [[], [], null]
      : await Promise.all([
          timed('halls', () => loadHalls(context)),
          timed('benchNotices', () => loadBenchNotices(context)),
          timed('pulse', () => loadPulseDue(context)),
        ]);
  const live = await LiveHalls({ halls });
  if (context !== null) {
    logger.info(
      {
        workspaceId: context.workspace.id,
        loaders: timings,
        totalMs: Math.round(performance.now() - started),
      },
      'today.timing',
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <SurfaceHelp slug={slug} surface="today" />
      {board ?? base}
      <BenchNoticeAlerts alerts={bench} slug={slug} />
      {live}
      {pulse === null ? null : <LoadPulseCard workspaceId={pulse} />}
    </div>
  );
}
