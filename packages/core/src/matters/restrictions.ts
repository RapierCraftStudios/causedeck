// Per-matter restrictions (#233, part of #20; architecture §6.3). A restricted matter is readable
// only by its listed users and owners (unless `ownersSeeRestrictedMatters` is off); to everyone
// else it does not exist, so these services answer `NOT_FOUND`, never `FORBIDDEN`, for it. The
// decision is `can()` from `@causedeck/auth/policy`; the role comes from the membership row, never
// from the caller, and every query runs in the actor's workspace scope under RLS.
import { isRole } from '@causedeck/auth';
import {
  assertCan,
  can,
  ForbiddenError,
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
import { and, eq, inArray } from 'drizzle-orm';

import { forbidden, invalid, notFound } from '../workspaces/errors.ts';
import { activeMember } from '../workspaces/members.ts';
import { memberRole } from '../workspaces/index.ts';

type Queryable = Database | Transaction;

const { matterRestriction, member } = schema;

export type MatterRestriction = typeof matterRestriction.$inferSelect;

/** Who is asking: the caller's role, if any, is replaced by the active membership's role. */
export type MatterActor = Omit<Actor, 'role'> & Partial<Pick<Actor, 'role'>>;

export interface RestrictMatterInput {
  matterId: string;
  /** Who may read the matter besides owners; each must be an active member of the workspace. */
  allowedUserIds: readonly string[];
  reason?: string | null;
}

export interface MatterRestrictionOptions {
  settings?: PolicySettings;
}

const matterNotFound = () => notFound('Matter not found');

/** The actor with their role from the membership row; `NOT_FOUND` when not an active member. */
async function resolveActor(tx: Queryable, actor: MatterActor): Promise<Actor> {
  const role = await memberRole(tx, actor.userId, actor.workspaceId);
  if (role === null || !isRole(role)) throw matterNotFound();
  return { ...actor, role };
}

function matterResource(
  workspaceId: string,
  matterId: string,
  restriction: MatterRestriction | undefined,
): Resource {
  return {
    kind: 'matter',
    workspaceId,
    matterId,
    ...(restriction === undefined
      ? {}
      : { restricted: { allowUserIds: restriction.allowedUserIds } }),
  };
}

async function loadRestriction(
  tx: Queryable,
  workspaceId: string,
  matterId: string,
): Promise<MatterRestriction | undefined> {
  const [row] = await tx
    .select()
    .from(matterRestriction)
    .where(
      and(eq(matterRestriction.workspaceId, workspaceId), eq(matterRestriction.matterId, matterId)),
    )
    .limit(1);
  return row;
}

/** `NOT_FOUND` unless the actor may read the matter; the resource for further checks. */
async function readableMatter(
  tx: Queryable,
  actor: Actor,
  matterId: string,
  settings: PolicySettings | undefined,
): Promise<{ resource: Resource; restriction: MatterRestriction | undefined }> {
  const restriction = await loadRestriction(tx, actor.workspaceId, matterId);
  const resource = matterResource(actor.workspaceId, matterId, restriction);
  if (!can(actor, 'matter.read', resource, settings).allow) throw matterNotFound();
  return { resource, restriction };
}

/** Malformed ids, or a call from inside another workspace's scope, find nothing. */
function checkIds(actor: MatterActor, matterId: string): void {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw matterNotFound();
  if (!isUuid(matterId)) throw matterNotFound();
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== actor.workspaceId.toLowerCase()
  ) {
    throw matterNotFound();
  }
}

/**
 * The matter's restriction (or `null` when it has none) if `actor` may read it; `NOT_FOUND` for a
 * restricted matter the actor is not listed on (owners see it unless the setting is off), and for
 * anyone who is not an active member of the workspace.
 */
export async function assertMatterReadable(
  db: Queryable,
  actor: MatterActor,
  matterId: string,
  settings?: PolicySettings,
): Promise<MatterRestriction | null> {
  checkIds(actor, matterId);
  return withWorkspace(db, { workspaceId: actor.workspaceId, userId: actor.userId }, async (tx) => {
    const resolved = await resolveActor(tx, actor);
    const { restriction } = await readableMatter(tx, resolved, matterId, settings);
    return restriction ?? null;
  });
}

/**
 * Create or replace the matter's restriction. Requires `matter.restrict` (advocate and above):
 * `FORBIDDEN` otherwise, but `NOT_FOUND` when the matter is already restricted and hidden from the
 * actor.
 */
export async function restrictMatter(
  db: Queryable,
  actor: MatterActor,
  input: RestrictMatterInput,
  options: MatterRestrictionOptions = {},
): Promise<MatterRestriction> {
  checkIds(actor, input.matterId);
  const allowed = [...new Set(input.allowedUserIds)];
  if (!allowed.every(isUuid)) throw invalid('allowedUserIds must be user ids');
  const { workspaceId, userId } = actor;
  return withWorkspace(db, { workspaceId, userId }, async (tx) => {
    const resolved = await resolveActor(tx, actor);
    const { resource } = await readableMatter(tx, resolved, input.matterId, options.settings);
    try {
      assertCan(resolved, 'matter.restrict', resource, options);
    } catch (error) {
      if (error instanceof ForbiddenError) throw forbidden('You cannot restrict this matter');
      throw error;
    }
    if (allowed.length > 0) {
      const members = await tx
        .select({ userId: member.userId })
        .from(member)
        .where(
          and(
            eq(member.organizationId, workspaceId),
            inArray(member.userId, allowed),
            activeMember,
          ),
        );
      if (members.length !== allowed.length) {
        throw invalid('allowedUserIds must be active members of the workspace');
      }
    }
    const [row] = await tx
      .insert(matterRestriction)
      .values({
        workspaceId,
        matterId: input.matterId,
        allowedUserIds: allowed,
        reason: input.reason ?? null,
        createdBy: userId,
      })
      .onConflictDoUpdate({
        target: [matterRestriction.workspaceId, matterRestriction.matterId],
        set: { allowedUserIds: allowed, reason: input.reason ?? null },
      })
      .returning();
    if (!row) throw new Error('restrictMatter: upsert returned no row');
    return row;
  });
}
