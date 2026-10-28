// Server half of the proof-of-value card (#86): reads the member's prefs and own answers and, for an
// owner, the matters a context test can run on. A failed read renders nothing instead of breaking
// the privacy page.
import type { WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { logger } from '../../../../../../src/health.ts';
import { ContextTestFlow } from '../../_pov/context-test-flow.tsx';

import { PovCard } from './_pov-card.tsx';

export async function PovSection({ context }: { context: WorkspaceContext }) {
  const actor = { workspaceId: context.workspace.id, userId: context.user.id };
  const isOwner = context.role === 'owner';
  try {
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { getPovPrefs, listPov } = await import('@causedeck/core/pov');
    const { listMatters } = await import('@causedeck/core/matter-graph');
    const loaded = await inWorkspace(actor, async (tx) => ({
      prefs: await getPovPrefs({ db: tx }, actor),
      own: await listPov({ db: tx }, actor),
      matters: isOwner
        ? (await listMatters({ db: tx, events: { emit() {} } }, actor, { limit: 50 })).items
        : [],
    }));
    return (
      <>
        <PovCard
          workspaceId={actor.workspaceId}
          enabled={loaded.prefs.promptsEnabled}
          ratings={loaded.own.ratings}
          pulses={loaded.own.pulses}
          isOwner={isOwner}
        />
        {isOwner ? (
          <ContextTestFlow
            workspaceId={actor.workspaceId}
            matters={loaded.matters.map((m) => ({ id: m.id, title: m.title }))}
            isOwner
          />
        ) : null}
      </>
    );
  } catch (error) {
    logger.error({ err: error }, 'privacy page: could not load proof of value');
    return null;
  }
}
