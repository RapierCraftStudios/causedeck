// The shared plumbing of the obligation service (#67), internal to the domain: parse the input,
// open the actor's workspace scope (RLS), take the role from the membership row and decide with
// `can()`. Matter access follows the matter's restriction and owner, as the matter-graph does.
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
import { and, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import { record, type AuditAction, type AuditMetadataValue } from '../audit/index.ts';
import type { GraphEvents } from '../matter-graph/index.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { activeMember } from '../shared/membership.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

const { matter, matterRestriction, member, obligation, obligationClerkView, obligationEvent } =
  schema;

export type ObligationRow = typeof obligation.$inferSelect;

export interface ObligationDeps {
  db: Database | Transaction;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  /** The clock; the system clock when omitted. */
  now?: () => Date;
  /** Graph events of the proceeding transitions a defect makes; dropped when omitted. */
  events?: GraphEvents;
}

export interface ObligationActor {
  workspaceId: string;
  userId: string;
}

export interface ObligationScope {
  tx: Transaction;
  actor: Actor;
  /** The actor's member id in this workspace. */
  memberId: string;
  settings: PolicySettings;
  now: Date;
}

export const notFoundObligation = () => notFound('Obligation not found');

export function parseObligationInput<S extends z.ZodType>(
  schemaOf: S,
  input: unknown,
): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

/** Run `fn` in the actor's workspace scope with the resolved role and member. */
export async function inObligationScope<T>(
  deps: ObligationDeps,
  actor: ObligationActor,
  fn: (scope: ObligationScope) => Promise<T>,
): Promise<T> {
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) throw notFoundObligation();
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw forbidden('Call made from inside another workspace');
  }
  return withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFoundObligation();
    const [self] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId), activeMember))
      .limit(1);
    if (self === undefined) throw notFoundObligation();
    const settings = deps.settings ?? toPolicySettings(await getRoleSettings(tx, workspaceId));
    return fn({
      tx,
      actor: { workspaceId, userId, role },
      memberId: self.id,
      settings,
      now: deps.now?.() ?? new Date(),
    });
  });
}

/** The matter if the actor may `action` it: NOT_FOUND when unreadable, FORBIDDEN when denied. */
export async function requireMatterFor(
  scope: ObligationScope,
  matterId: string,
  action: Action,
): Promise<typeof matter.$inferSelect> {
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
  if (row === undefined) throw notFound('Matter not found');
  const resource: Resource = {
    kind: 'matter',
    workspaceId: actor.workspaceId,
    matterId,
    ...(row.allowUserIds === null ? {} : { restricted: { allowUserIds: row.allowUserIds } }),
    ...(row.ownerUserId === null ? {} : { ownerUserId: row.ownerUserId }),
  };
  if (!can(actor, 'matter.read', resource, settings).allow) throw notFound('Matter not found');
  if (!can(actor, action, resource, settings).allow) {
    throw forbidden('You cannot change this obligation');
  }
  return row.matter;
}

/** SQL that keeps rows of matters the actor may read through `obligation.read`. */
export function visibleMatters(scope: ObligationScope): SQL {
  const { actor, settings } = scope;
  const listed = sql`${actor.userId}::uuid = any(${matterRestriction.allowedUserIds})`;
  const ownerSees = actor.role === 'owner' && settings.ownersSeeRestrictedMatters !== false;
  const restriction = ownerSees
    ? sql`true`
    : sql`(${matterRestriction.matterId} is null or ${listed})`;
  if (actor.role !== 'junior') return restriction;
  return sql`${restriction} and (${member.userId} = ${actor.userId}::uuid or coalesce(${listed}, false))`;
}

/** The obligation row, readable by the actor, or NOT_FOUND. */
export async function loadObligation(
  scope: ObligationScope,
  obligationId: string,
  action: Action,
): Promise<ObligationRow> {
  const [row] = await scope.tx
    .select()
    .from(obligation)
    .where(
      and(eq(obligation.workspaceId, scope.actor.workspaceId), eq(obligation.id, obligationId)),
    )
    .limit(1)
    .for('update');
  if (row === undefined) throw notFoundObligation();
  // A clerk reads a strategy obligation's task only through `obligation_clerk_v`, never to change it.
  if (row.strategy && scope.actor.role === 'clerk')
    throw forbidden('You cannot change this obligation');
  try {
    await requireMatterFor(scope, row.matterId, action);
  } catch (error) {
    if ((error as { code?: string }).code === 'NOT_FOUND') throw notFoundObligation();
    throw error;
  }
  return row;
}

/**
 * The obligation source a read in `scope` selects from: the table, or for a clerk the column-scoped
 * view (the clerk role has no privilege on the table). The view has the table's columns, so it is
 * typed as the table; its `description` is NULL on strategy rows (see `visibleDescription`).
 */
export const readableObligation = (scope: ObligationScope): typeof obligation =>
  (scope.actor.role === 'clerk' ? obligationClerkView : obligation) as unknown as typeof obligation;

/**
 * Run a read that selects from `readableObligation(scope)`: for a clerk in a nested clerk-role scope
 * (restored afterwards), so the table stays out of reach even through a bug.
 */
export function readObligations<T>(
  scope: ObligationScope,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (scope.actor.role !== 'clerk') return fn(scope.tx);
  const { workspaceId, userId } = scope.actor;
  return withWorkspace(scope.tx, { workspaceId, userId, dbRole: 'clerk' }, fn);
}

/** The columns of `source` (the table or the clerk view) as a select list: drizzle expands a table, not a view. */
export const obligationColumns = (source: typeof obligation): typeof obligation._.columns =>
  Object.fromEntries(
    Object.keys(getTableColumns(obligation)).map((k) => [
      k,
      (source as unknown as Record<string, unknown>)[k],
    ]),
  ) as typeof obligation._.columns;

/** The row as the actor may see it: a hidden (NULL) description reads as an empty string. */
export const visibleRow = (
  row: Omit<ObligationRow, 'description'> & { description: string | null },
): ObligationRow => ({
  ...row,
  description: row.description ?? '',
});

/** The action a write of an obligation of `source` needs: clerks track tasks and copies only. */
export const writeActionFor = (source: ObligationRow['source']): Action =>
  source === 'internal' || source === 'certified_copy' || source === 'registry_defect'
    ? 'obligation.track'
    : 'obligation.write';

/** An active member of the workspace, or INVALID. */
export async function requireOwnerMember(tx: Transaction, workspaceId: string, memberId: string) {
  const [row] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), eq(member.id, memberId), activeMember))
    .limit(1);
  if (row === undefined) throw invalid('ownerMemberId: not an active member of this workspace');
}

export async function addEvent(
  scope: ObligationScope,
  obligationId: string,
  event: {
    kind: (typeof obligationEvent.$inferInsert)['kind'];
    fromValue?: string | null;
    toValue?: string | null;
    reason?: string | null;
  },
): Promise<void> {
  await scope.tx.insert(obligationEvent).values({
    workspaceId: scope.actor.workspaceId,
    obligationId,
    kind: event.kind,
    fromValue: event.fromValue ?? null,
    toValue: event.toValue ?? null,
    reason: event.reason ?? null,
    actorMemberId: scope.memberId,
    at: scope.now,
  });
}

/** One audit event for a mutation: ids and flags only. */
export async function audit(
  scope: ObligationScope,
  action: AuditAction,
  target: { kind: string; id: string },
  metadata: Record<string, AuditMetadataValue> = {},
): Promise<void> {
  await record(
    {
      db: scope.tx,
      workspaceId: scope.actor.workspaceId,
      actor: { userId: scope.actor.userId, kind: 'user' },
    },
    { action, target, metadata },
  );
}
