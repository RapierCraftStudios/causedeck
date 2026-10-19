// Members, roles, ownership transfer and seats (#177, #18). Who may change roles, remove members or
// transfer ownership is the central policy's call (`can()` from `@causedeck/auth/policy`, #234:
// owner-only today), and a workspace always keeps at least one active owner.
import { can, isRole, type Action } from '@causedeck/auth/policy';
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq, sql } from 'drizzle-orm';

import { activeMember, liveWorkspace } from '../shared/membership.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';
import { offboardMember } from './offboarding.ts';

type Queryable = Database | Transaction;
type WorkspaceRole = (typeof schema.member.$inferSelect)['role'];

const { member, organization, session, user } = schema;

const ROLE_VALUES = ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const;
type SeatRole = (typeof ROLE_VALUES)[number];

export { activeMember, liveWorkspace } from '../shared/membership.ts';

interface WorkspaceRow {
  id: string;
  slug: string;
}

/**
 * Lock the live workspace row and check that `userId` is an active member whose role the policy
 * allows `action`. A missing or soft-deleted workspace is `NOT_FOUND`; anyone else is `FORBIDDEN`.
 */
export async function requireCan(
  tx: Queryable,
  workspaceId: string,
  userId: string,
  action: Action,
): Promise<WorkspaceRow> {
  const [workspace] = await tx
    .select({ id: organization.id, slug: organization.slug })
    .from(organization)
    .where(and(eq(organization.id, workspaceId), liveWorkspace))
    .for('update');
  if (!workspace) throw notFound();
  const [actor] = await tx
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId), activeMember));
  if (
    !actor ||
    !isRole(actor.role) ||
    !can({ userId, workspaceId, role: actor.role }, action).allow
  ) {
    throw forbidden();
  }
  return workspace;
}

/** `requireCan` for role management (`member.role`), which only owners hold. */
export async function requireOwner(
  tx: Queryable,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRow> {
  return requireCan(tx, workspaceId, userId, 'member.role');
}

async function activeOwnerCount(tx: Queryable, workspaceId: string): Promise<number> {
  const owners = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), eq(member.role, 'owner'), activeMember))
    .for('update');
  return owners.length;
}

async function activeMemberById(tx: Queryable, workspaceId: string, memberId: string) {
  const [row] = await tx
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, workspaceId), activeMember))
    .for('update');
  if (!row) throw notFound('Member not found');
  return row;
}

export interface MemberSummary {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: Date;
  /** Latest activity on any of the user's sessions, or `null` when they have none. */
  lastActiveAt: Date | null;
}

/** Active members of a live workspace, earliest joiner first. */
export async function listMembers(db: Queryable, workspaceId: string): Promise<MemberSummary[]> {
  return db
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.joinedAt,
      lastActiveAt:
        sql<Date | null>`(select max(${session.updatedAt}) from ${session} where ${session.userId} = ${member.userId})`.mapWith(
          (value: string | Date) => new Date(value),
        ),
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.organizationId, workspaceId), activeMember, liveWorkspace))
    .orderBy(asc(member.joinedAt), asc(member.id));
}

export interface ChangeRoleRequest {
  workspaceId: string;
  actorUserId: string;
  memberId: string;
  role: WorkspaceRole;
}

/** Needs `member.role` (owners). Demoting the last active owner is a `CONFLICT`. */
export async function changeRole(db: Queryable, request: ChangeRoleRequest): Promise<void> {
  if (!(ROLE_VALUES as readonly string[]).includes(request.role)) {
    throw invalid(`Unknown role: ${request.role}`);
  }
  await db.transaction(async (tx) => {
    await requireCan(tx, request.workspaceId, request.actorUserId, 'member.role');
    const target = await activeMemberById(tx, request.workspaceId, request.memberId);
    if (target.role === request.role) return;
    if (target.role === 'owner' && (await activeOwnerCount(tx, request.workspaceId)) <= 1) {
      throw conflict('The last owner cannot be demoted; transfer ownership first');
    }
    await tx.update(member).set({ role: request.role }).where(eq(member.id, target.id));
  });
}

export interface RemoveMemberRequest {
  workspaceId: string;
  actorUserId: string;
  memberId: string;
  /** Member id that takes over the removed member's open work (required when any exists). */
  reassignTo?: string | undefined;
}

/**
 * Owner-only; runs the offboarding service (reassign, revoke workspace sessions, mark `removed`,
 * audit). Removing the last active owner is a `CONFLICT`.
 */
export async function removeMember(db: Queryable, request: RemoveMemberRequest): Promise<void> {
  await db.transaction(async (tx) => {
    await requireCan(tx, request.workspaceId, request.actorUserId, 'member.remove');
    const target = await activeMemberById(tx, request.workspaceId, request.memberId);
    if (target.role === 'owner' && (await activeOwnerCount(tx, request.workspaceId)) <= 1) {
      throw conflict('The last owner cannot be removed; transfer ownership first');
    }
    await offboardMember(tx, {
      workspaceId: request.workspaceId,
      actorUserId: request.actorUserId,
      target: { memberId: target.id, userId: target.userId },
      reassignTo: request.reassignTo,
    });
  });
}

export interface OwnershipTransferRequest {
  workspaceId: string;
  actorUserId: string;
  newOwnerUserId: string;
}

export interface OwnershipTransferPlan {
  /** Step 2 must echo this back (the workspace slug, typed by the owner to confirm). */
  confirmation: string;
  newOwner: { userId: string; name: string; email: string; role: WorkspaceRole };
}

async function transferTarget(tx: Queryable, request: OwnershipTransferRequest) {
  if (request.newOwnerUserId === request.actorUserId) {
    throw invalid('You already own this workspace');
  }
  const [target] = await tx
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, request.workspaceId),
        eq(member.userId, request.newOwnerUserId),
        activeMember,
      ),
    );
  if (!target) throw notFound('Member not found');
  return target;
}

/** Step 1 of an ownership transfer: checks it is allowed and returns what to confirm. */
export async function prepareOwnershipTransfer(
  db: Queryable,
  request: OwnershipTransferRequest,
): Promise<OwnershipTransferPlan> {
  return db.transaction(async (tx) => {
    const workspace = await requireCan(tx, request.workspaceId, request.actorUserId, 'member.role');
    const { userId, name, email, role } = await transferTarget(tx, request);
    return { confirmation: workspace.slug, newOwner: { userId, name, email, role } };
  });
}

/**
 * Step 2: with the confirmation from step 1, the target becomes `owner` and the acting owner
 * becomes `advocate`, atomically. A missing or wrong confirmation is a `VALIDATION` error.
 */
export async function transferOwnership(
  db: Queryable,
  request: OwnershipTransferRequest & { confirmation: string | undefined },
): Promise<void> {
  await db.transaction(async (tx) => {
    const workspace = await requireCan(tx, request.workspaceId, request.actorUserId, 'member.role');
    if (request.confirmation !== workspace.slug) {
      throw invalid('Confirm the transfer by entering the workspace slug');
    }
    const target = await transferTarget(tx, request);
    await tx.update(member).set({ role: 'owner' }).where(eq(member.id, target.memberId));
    await tx
      .update(member)
      .set({ role: 'advocate' })
      .where(
        and(eq(member.organizationId, request.workspaceId), eq(member.userId, request.actorUserId)),
      );
  });
}

export interface SeatCount {
  /** Every active member. */
  total: number;
  byRole: Record<SeatRole, number>;
  /** Clerk seats are priced separately (#28). */
  clerk: number;
  nonClerk: number;
}

/** Active members by role, for seat billing (#28). Suspended and removed members are free. */
export async function countBillableSeats(db: Queryable, workspaceId: string): Promise<SeatCount> {
  const rows = await db
    .select({ role: member.role, count: sql<number>`count(*)::int` })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), activeMember))
    .groupBy(member.role);
  const byRole = Object.fromEntries(ROLE_VALUES.map((role) => [role, 0])) as Record<
    SeatRole,
    number
  >;
  for (const { role, count } of rows) {
    if ((ROLE_VALUES as readonly string[]).includes(role)) byRole[role as SeatRole] = count;
  }
  const total = ROLE_VALUES.reduce((sum, role) => sum + byRole[role], 0);
  return { total, byRole, clerk: byRole.clerk, nonClerk: total - byRole.clerk };
}

/** Seat entitlement gate (#28). Invitations (#178) call it before adding a seat. */
export interface Entitlements {
  /** Throws (e.g. a `CONFLICT` WorkspaceError) when the workspace has no seat left for `role`. */
  assertCanAddSeat(db: Queryable, workspaceId: string, role: WorkspaceRole): Promise<void>;
}

/** v1 default: every seat is allowed until billing (#28) provides a real implementation. */
export const permissiveEntitlements: Entitlements = {
  assertCanAddSeat: () => Promise.resolve(),
};

let activeEntitlements: Entitlements = permissiveEntitlements;

/** The installed entitlements; delegates so callers can hold a stable reference. */
export const entitlements: Entitlements = {
  assertCanAddSeat: (db, workspaceId, role) =>
    activeEntitlements.assertCanAddSeat(db, workspaceId, role),
};

/** Install an entitlements implementation (billing, tests); `null` restores the permissive default. */
export function setEntitlements(implementation: Entitlements | null): void {
  activeEntitlements = implementation ?? permissiveEntitlements;
}
