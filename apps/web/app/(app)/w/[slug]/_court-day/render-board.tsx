// Shared page body of `/today` and `/tomorrow` (#59). The placeholder page runs first so its guards
// (membership, flag, permission, dev states) stay as they were; its empty state is replaced by the
// board unless a dev state is being previewed.
import { getLocale } from 'next-intl/server';

import type {
  PlaceholderRoute,
  WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { CourtDayBoard } from './court-day-board.tsx';
import { istDate, loadBoard } from './load-court-day.ts';

export async function renderBoard(
  props: WorkspacePageProps,
  which: Extract<PlaceholderRoute, 'today' | 'tomorrow'>,
  guards: (props: WorkspacePageProps) => Promise<React.JSX.Element>,
): Promise<{ base: React.JSX.Element; board: React.JSX.Element | null }> {
  const base = await guards(props);
  const [{ slug }, query] = await Promise.all([props.params, props.searchParams]);
  if (query.__state !== undefined) return { base, board: null };
  const context = await getWorkspaceContext(slug);
  if (!context) return { base, board: null };
  const data = await loadBoard({
    workspaceId: context.workspace.id,
    userId: context.user.id,
    role: context.role,
    date: istDate(new Date(), which === 'today' ? 0 : 1),
  });
  const hall = query.hall;
  return {
    base,
    board: (
      <CourtDayBoard
        slug={slug}
        workspaceId={context.workspace.id}
        which={which}
        locale={await getLocale()}
        canWrite={can(context.role, 'matter.write')}
        board={data}
        selectedHall={Array.isArray(hall) ? hall[0] : hall}
      />
    ),
  };
}
