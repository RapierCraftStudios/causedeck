// Server mount for a surface's help (#94): the contextual `?` tip and the first-run coachmark
// (hidden once the member dismissed it). A failed read of the dismissals only shows the coachmark.
import { getWorkspaceContext } from '../../lib/workspace-loader.ts';
import { logger } from '../../src/health.ts';

import { Coachmark, ContextualTip, coachmarkKey } from './contextual-tip.tsx';

export interface SurfaceHelpProps {
  slug: string;
  surface: 'today' | 'inbox' | 'obligations' | 'briefs' | 'memory';
}

async function dismissedKeys(workspaceId: string, userId: string): Promise<string[]> {
  try {
    const { db } = await import('@causedeck/core/runtime');
    const { listDismissedCoachmarks } = await import('@causedeck/core/help');
    return await listDismissedCoachmarks(db, { workspaceId, userId });
  } catch (error) {
    logger.error({ err: error }, 'help: could not read dismissed coachmarks');
    return [];
  }
}

export async function SurfaceHelp({ slug, surface }: SurfaceHelpProps) {
  const context = await getWorkspaceContext(slug);
  if (!context) return null;
  const workspaceId = context.workspace.id;
  const dismissed = (await dismissedKeys(workspaceId, context.user.id)).includes(
    coachmarkKey(surface),
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <ContextualTip surface={surface} workspaceId={workspaceId} role={context.role} />
      </div>
      <Coachmark surface={surface} workspaceId={workspaceId} dismissed={dismissed} />
    </div>
  );
}
