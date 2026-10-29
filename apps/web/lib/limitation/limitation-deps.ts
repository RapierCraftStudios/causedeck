// Server-only seam between the limitation screens and the limitation services (#941, #84 part 3).
// The services take `LimitationDeps` and open the actor's workspace scope themselves; the app hands
// them the transaction it already holds (`inWorkspace` here, `ctx.tx` in server actions) and never
// imports `db` (#298). The page has already checked the `limitation.enabled` flag (a dark feature is
// a 404), so a `LimitationDisabledError` from core is only a backstop and reads as a denial.
import type { ComputationView, LimitationDeps, RuleView } from '@causedeck/core/limitation';
import type { Transaction } from '@causedeck/core/runtime';

import { logger } from '../../src/health.ts';
import type { WorkspaceContext } from '../workspace-context.ts';

/** The limitation deps for a transaction the caller already opened. */
export function limitationDeps(tx: Transaction): LimitationDeps {
  return { db: tx };
}

export type LimitationLoad =
  | { kind: 'list'; computations: ComputationView[]; rules: RuleView[] }
  | { kind: 'denied' }
  | { kind: 'error' };

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** The workspace's computations and rules for the member; a denial and a failure are results. */
export async function loadLimitations(context: WorkspaceContext): Promise<LimitationLoad> {
  try {
    const [runtime, limitation] = await Promise.all([
      import('@causedeck/core/runtime'),
      import('@causedeck/core/limitation'),
    ]);
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    return await runtime.inWorkspace(scope, async (tx) => {
      const deps = limitationDeps(tx);
      const computations = await limitation.listLimitations(deps, scope);
      const rules = await limitation.listRules(deps, scope);
      return { kind: 'list' as const, computations, rules };
    });
  } catch (error) {
    if (codeOf(error) === 'FORBIDDEN') return { kind: 'denied' };
    logger.error({ err: error }, 'limitation page: could not load the computations');
    return { kind: 'error' };
  }
}
