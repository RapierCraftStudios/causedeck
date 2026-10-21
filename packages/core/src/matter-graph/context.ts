// The shared plumbing of the matter-graph services (#362), internal to the domain. Each service
// parses its input with zod, refuses malformed actor ids and calls made from inside another
// workspace's scope, opens the actor's workspace scope (`withWorkspace`, RLS), takes the role from
// the membership row (never from the caller) and decides with `can()`, as matters/restrictions.ts
// does. Events are collected while the scope runs and emitted only once it has resolved, so a
// rolled-back write emits nothing.
import { isRole } from '@causedeck/auth';
import {
  can,
  type Action,
  type Actor,
  type PolicySettings,
  type Resource,
} from '@causedeck/auth/policy';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Database,
  type Transaction,
} from '@causedeck/db';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import type { MatterActor } from '../matters/index.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import { crossWorkspace, graphNotFound } from './errors.ts';
import type { GraphEvent, GraphEvents } from './events.ts';

const { matter, matterRestriction, member } = schema;

/** What every matter-graph service is given besides the actor and the input. */
export interface MatterGraphDeps {
  db: Database | Transaction;
  events: GraphEvents;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
}

/** Who is asking: the caller's role, if any, is replaced by the active membership's role. */
export type GraphActor = MatterActor;

export type MatterRow = typeof matter.$inferSelect;

/** A running service call: the scoped transaction, the resolved actor and the event buffer. */
export interface GraphScope {
  tx: Transaction;
  actor: Actor;
  settings: PolicySettings;
  emit: (event: GraphEvent) => void;
}

/** The parsed input, or VALIDATION with the first issue's message. */
export function parseInput<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

/** Malformed actor ids find nothing; a call from inside another workspace's scope is refused. */
function checkActor(actor: GraphActor): void {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw notFound('Matter not found');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== actor.workspaceId.toLowerCase()
  ) {
    throw crossWorkspace();
  }
}

/** Run `fn` in the actor's workspace scope; emit its events once the scope has resolved. */
export async function inGraphScope<T>(
  deps: MatterGraphDeps,
  actor: GraphActor,
  fn: (scope: GraphScope) => Promise<T>,
): Promise<T> {
  checkActor(actor);
  const events: GraphEvent[] = [];
  const { workspaceId, userId } = actor;
  const result = await withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFound('Matter not found');
    const settings = deps.settings ?? toPolicySettings(await getRoleSettings(tx, workspaceId));
    return fn({ tx, actor: { ...actor, role }, settings, emit: (e) => events.push(e) });
  });
  for (const event of events) deps.events.emit(event);
  return result;
}

/** The policy resource of a matter row, with its restriction and owner. */
export function matterResource(
  workspaceId: string,
  matterId: string,
  allowUserIds: readonly string[] | null,
  ownerUserId: string | null,
): Resource {
  return {
    kind: 'matter',
    workspaceId,
    matterId,
    ...(allowUserIds === null ? {} : { restricted: { allowUserIds } }),
    ...(ownerUserId === null ? {} : { ownerUserId }),
  };
}

/**
 * The matter if the actor may `action` it: NOT_FOUND when the workspace has no such matter or the
 * actor may not read it, FORBIDDEN when readable but `action` is denied.
 */
export async function requireMatter(
  scope: GraphScope,
  matterId: string,
  action: Action,
): Promise<MatterRow> {
  const { tx, actor, settings } = scope;
  const [row] = await tx
    .select({ matter, ownerUserId: member.userId, allowUserIds: matterRestriction.allowedUserIds })
    .from(matter)
    .leftJoin(
      member,
      and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
    )
    .leftJoin(
      matterRestriction,
      and(
        eq(matterRestriction.workspaceId, matter.workspaceId),
        eq(matterRestriction.matterId, matter.id),
      ),
    )
    .where(and(eq(matter.workspaceId, actor.workspaceId), eq(matter.id, matterId)))
    .limit(1);
  if (row === undefined) throw graphNotFound('matter');
  const resource = matterResource(actor.workspaceId, matterId, row.allowUserIds, row.ownerUserId);
  if (!can(actor, 'matter.read', resource, settings).allow) throw graphNotFound('matter');
  if (action !== 'matter.read' && !can(actor, action, resource, settings).allow) {
    throw forbidden('You cannot change this matter');
  }
  return row.matter;
}

/** The Postgres error under drizzle's wrapper: SQLSTATE and constraint name, if any. */
export function pgError(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    // postgres.js names the constraint `constraint_name`.
    const { code, constraint_name, cause } = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return {
        code,
        ...(typeof constraint_name === 'string' ? { constraint: constraint_name } : {}),
      };
    }
    current = cause;
  }
  return {};
}
