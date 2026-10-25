// The shared plumbing of the outward-draft service (#735), internal to the domain: parse the
// input, open the actor's workspace scope (RLS), take the role from the membership row and decide
// with `can()`. Every call is a member's act: there is no system actor here.
import type { AiGateway } from '@causedeck/ai';
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

import { record, type AuditAction, type AuditMetadataValue } from '../audit/index.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { activeMember } from '../shared/membership.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

const { matter, matterRestriction, member } = schema;

export interface OutwardDeps {
  db: Database | Transaction;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  /** The clock; the system clock when omitted. */
  now?: () => Date;
  /** The AI gateway; the core gateway over the scope's transaction when omitted. */
  gateway?: AiGateway;
}

export interface OutwardActor {
  workspaceId: string;
  userId: string;
}

export interface OutwardScope {
  tx: Transaction;
  actor: Actor;
  /** The actor's member id in this workspace. */
  memberId: string;
  settings: PolicySettings;
  now: Date;
}

export const notFoundDraft = () => notFound('Draft not found');

export function parseOutwardInput<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

/** Run `fn` in the actor's workspace scope with the resolved role and member. */
export async function inOutwardScope<T>(
  deps: OutwardDeps,
  actor: OutwardActor,
  fn: (scope: OutwardScope) => Promise<T>,
): Promise<T> {
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) throw notFoundDraft();
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw forbidden('Call made from inside another workspace');
  }
  return withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFoundDraft();
    const [self] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId), activeMember))
      .limit(1);
    if (self === undefined) throw notFoundDraft();
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
  scope: OutwardScope,
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
    throw forbidden('You cannot draft for this matter');
  }
  return row.matter;
}

/** One audit event for a mutation: ids and flags only, never draft text. */
export async function audit(
  scope: OutwardScope,
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
