// Server-only seam between the practice insights screens and the insights services (#85). The page
// holds no database handle: the services open the actor's workspace scope on the transaction the
// runtime hands them (#298). A denial and a failure are results the page renders, not throws.
import type { PracticeInsights } from '@causedeck/validators/insights';
import { InsightsQuery } from '@causedeck/validators/insights';

import { logger } from '../../src/health.ts';
import type { WorkspaceContext } from '../workspace-context.ts';

export type InsightsLoad =
  { kind: 'ready'; data: PracticeInsights } | { kind: 'denied' } | { kind: 'error' };

type Param = string | string[] | undefined;

const first = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : value);

/** The range the URL asks for; anything malformed falls back to the default (12 weeks). */
export function parseInsightsQuery(search: Record<string, Param>): InsightsQuery {
  const candidate = {
    range: first(search.range),
    from: first(search.from),
    to: first(search.to),
  };
  const parsed = InsightsQuery.safeParse(
    Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== undefined && v !== '')),
  );
  return parsed.success ? parsed.data : InsightsQuery.parse({});
}

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** The practice insights for the member and range; FORBIDDEN and NOT_FOUND read as a denial. */
export async function loadInsights(
  context: WorkspaceContext,
  query: InsightsQuery,
): Promise<InsightsLoad> {
  try {
    const [runtime, insights] = await Promise.all([
      import('@causedeck/core/runtime'),
      import('@causedeck/core/insights'),
    ]);
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    const data = await runtime.inWorkspace(scope, (tx) =>
      insights.getPracticeInsights({ db: tx }, scope, query),
    );
    return { kind: 'ready', data };
  } catch (error) {
    const code = codeOf(error);
    if (code === 'FORBIDDEN' || code === 'NOT_FOUND') return { kind: 'denied' };
    logger.error({ err: error }, 'insights page: could not compute the practice insights');
    return { kind: 'error' };
  }
}
