// The scope of an engine call (#47): the actor's workspace transaction, the membership role and a
// buffer for matter-graph events. As the matter-graph services do (`matter-graph/context.ts`), it
// parses nothing the caller could forge: the role comes from the membership row, and a call made
// from inside another workspace's scope is refused. Events reach `deps.events` only once the
// transaction has resolved, so a rolled-back call emits nothing.
import { isRole } from '@causedeck/auth';
import { can, type Action, type Actor } from '@causedeck/auth/policy';
import { currentScope, isUuid, withWorkspace } from '@causedeck/db';

import { type GraphActor, type GraphEvent, type MatterGraphDeps } from '../matter-graph/index.ts';
import { forbidden, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import type { HandlerScope } from './types.ts';

function checkActor(actor: GraphActor): void {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw notFound('Workspace not found');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== actor.workspaceId.toLowerCase()
  ) {
    throw notFound('Workspace not found');
  }
}

/** Run `fn` as the actor in their workspace's scope; graph events go out after it resolves. */
export async function inAutomationScope<T>(
  deps: MatterGraphDeps,
  actor: GraphActor,
  fn: (scope: HandlerScope) => Promise<T>,
): Promise<T> {
  checkActor(actor);
  const buffered: GraphEvent[] = [];
  const { workspaceId, userId } = actor;
  const result = await withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFound('Workspace not found');
    const settings = deps.settings ?? toPolicySettings(await getRoleSettings(tx, workspaceId));
    return fn({
      tx,
      actor,
      member: { ...actor, role },
      deps: { ...deps, db: tx, settings, events: { emit: (event) => buffered.push(event) } },
      now: deps.now ?? (() => new Date()),
    });
  });
  for (const event of buffered) deps.events.emit(event);
  return result;
}

/** FORBIDDEN unless the member may `action` in the workspace. */
export function requireCan(scope: HandlerScope, action: Action, message: string): void {
  const actor: Actor = scope.member;
  if (!can(actor, action, undefined, scope.deps.settings).allow) throw forbidden(message);
}
