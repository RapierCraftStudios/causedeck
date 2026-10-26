// Shared page body of `/today` and `/tomorrow` (#59). The placeholder page runs first so its guards
// (membership, flag, permission, dev states) stay as they were; its empty state is replaced by the
// board unless a dev state is being previewed.
import { getLocale } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import type {
  PlaceholderRoute,
  WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';
import { workspaceFlagCheck } from '../../../../../lib/flags.ts';
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
  let data;
  try {
    data = await loadBoard({
      workspaceId: context.workspace.id,
      userId: context.user.id,
      role: context.role,
      date: istDate(new Date(), which === 'today' ? 0 : 1),
    });
  } catch (error) {
    // A role without the court day sees the permission state; anything else reaches the boundary.
    if (error instanceof Error && 'code' in error && error.code === 'FORBIDDEN') {
      return { base, board: <PermissionDeniedPage /> };
    }
    throw error;
  }
  // Who sat is a bench fact, behind the legal-gated flag (D-050); resolved here, on the server.
  const showBench = (await workspaceFlagCheck(context))('bench_facts');
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
        showBench={showBench}
        selectedHall={Array.isArray(hall) ? hall[0] : hall}
      />
    ),
  };
}
