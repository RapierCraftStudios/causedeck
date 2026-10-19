// Server-only feature-flag wiring (#22, docs/engineering/flags.md). The workspace layout evaluates
// every flag once per request and hands the boolean snapshot to the shell (`FlagsProvider`), so the
// nav, the command palette and shortcuts hide dark features; pages gate themselves with
// `requireWorkspaceFlag`, which turns `FEATURE_OFF` into a plain 404. Never import from a client
// component: client code reads flags with `@causedeck/flags/react`.
import type { FlagKey, FlagSnapshot } from '@causedeck/flags/keys';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import type { WorkspaceContext } from './workspace-context.ts';

type FlagScope = Pick<WorkspaceContext, 'workspace' | 'user'>;

let listening: Promise<unknown> | undefined;

/**
 * `LISTEN flag_changed` once per Node process so staff changes drop the cache immediately (the
 * 15 s TTL bounds staleness if it fails). Loaded lazily: importing this module opens nothing.
 */
function startListener(): void {
  // Node runtime only: the workspace layout and pages that call this never run on the edge.
  if (listening !== undefined) return;
  listening = Promise.all([import('@causedeck/db'), import('@causedeck/flags')])
    .then(([{ db }, { startFlagListener }]) => startFlagListener(db))
    .catch((error: unknown) => {
      listening = undefined;
      console.warn('flags: LISTEN flag_changed failed; relying on the cache TTL', error);
    });
}

/** Every flag for the workspace, evaluated server-side; memoised per request. */
export const getWorkspaceFlags = cache(async (context: FlagScope): Promise<FlagSnapshot> => {
  startListener();
  const { evaluateAll } = await import('@causedeck/flags/server');
  return evaluateAll({ workspaceId: context.workspace.id, userId: context.user.id });
});

/** `(key) => boolean` over the request's snapshot, for server components. */
export async function workspaceFlagCheck(context: FlagScope): Promise<(key: FlagKey) => boolean> {
  const flags = await getWorkspaceFlags(context);
  return (key) => flags[key];
}

/** `notFound()` unless `key` is on for the workspace: a dark feature looks like a missing route. */
export async function requireWorkspaceFlag(key: FlagKey, context: FlagScope): Promise<void> {
  startListener();
  const { isFlagOffError, requireFlag } = await import('@causedeck/flags/server');
  try {
    await requireFlag(key, { workspaceId: context.workspace.id, userId: context.user.id });
  } catch (error) {
    if (isFlagOffError(error)) notFound();
    throw error;
  }
}
