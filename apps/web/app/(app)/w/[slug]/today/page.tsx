// `/w/[slug]/today` (#493): the court-day view. The placeholder stays until the day view lands; the
// live halls section (hall, item now, status, your item N away, estimated window) sits under it.
// It renders nothing while `court.live-tracking` is off or the member has no item listed today, and
// a failed read never breaks the page.
import type { LiveHall } from '@causedeck/core/court-day';

import { LiveHalls } from '../../../../../components/court-day/live-halls.tsx';
import {
  placeholderPage,
  type WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';
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

export default async function TodayPage(props: WorkspacePageProps) {
  // The placeholder renders first so its guards (membership, permission, dev states) run unchanged.
  const base = await Placeholder(props);
  const { slug } = await props.params;
  const live = await LiveHalls({ halls: await loadHalls(slug) });
  if (live === null) return base;
  return (
    <div className="flex flex-col gap-6">
      {base}
      {live}
    </div>
  );
}
