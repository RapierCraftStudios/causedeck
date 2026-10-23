// Server-only loading for the forum detail routes (#400): runs a courts read model in this
// workspace's RLS scope (`inWorkspace`, `@causedeck/core/court`) and maps core's errors to the page
// states: NOT_FOUND (an unknown or other workspace's forum code) to a 404, FORBIDDEN to
// permission-denied, anything else to the load error. Never import from a client component.
import type * as Court from '@causedeck/core/court';

import { logger } from '../src/health.ts';

import type { WorkspaceContext } from './workspace-context.ts';

/** The transaction a read model takes. */
type Queryable = Parameters<typeof Court.getCourtsIndex>[0];

export type CourtLoad<T> =
  { kind: 'ok'; value: T } | { kind: 'not-found' } | { kind: 'denied' } | { kind: 'error' };

/** The forum code from the route segment, decoded once (codes are plain, but a URL may encode). */
export function forumCodeParam(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export async function loadCourtData<T>(
  context: WorkspaceContext,
  what: string,
  load: (court: typeof Court, tx: Queryable, workspaceId: string) => Promise<T>,
): Promise<CourtLoad<T>> {
  try {
    // One at a time, not in a Promise.all: concurrent imports race the test mocks.
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const court = await import('@causedeck/core/court');
    const workspaceId = context.workspace.id;
    const value = await inWorkspace({ workspaceId, userId: context.user.id }, (tx) =>
      load(court, tx, workspaceId),
    );
    return { kind: 'ok', value };
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
      if (error.code === 'NOT_FOUND') return { kind: 'not-found' };
      if (error.code === 'FORBIDDEN') return { kind: 'denied' };
    }
    logger.error({ err: error }, `courts forum: could not load ${what}`);
    return { kind: 'error' };
  }
}
