// Clerk-led onboarding (#505): a clerk invited by the senior sets up the practice, then asks for
// the senior's one-tap approval. The state is two nullable columns on `member`
// (`clerk_setup_status`, `clerk_setup_decided_at`); it grants nothing, so clerk permissions are
// unchanged (the matrix in `@causedeck/auth/policy` is the only source of what a clerk may do).
// The clerk asks for approval for themselves; a member with `workspace.manage` approves.
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq } from 'drizzle-orm';

import { conflict, forbidden } from './errors.ts';
import { activeMember, liveWorkspace, requireCan } from './members.ts';

type Queryable = Database | Transaction;

const { member, organization, user } = schema;

export type ClerkSetupStatus = 'pending' | 'approved';

export interface ClerkSetup {
  memberId: string;
  userId: string;
  name: string;
  /** `null` until the clerk has asked for approval. */
  status: ClerkSetupStatus | null;
  decidedAt: Date | null;
}

function asStatus(value: string | null): ClerkSetupStatus | null {
  return value === 'pending' || value === 'approved' ? value : null;
}

/** The active clerks of a live workspace with their setup state, earliest joiner first. */
export async function getClerkSetup(db: Queryable, workspaceId: string): Promise<ClerkSetup[]> {
  const rows = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      status: member.clerkSetupStatus,
      decidedAt: member.clerkSetupDecidedAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.role, 'clerk'),
        activeMember,
        liveWorkspace,
      ),
    )
    .orderBy(asc(member.joinedAt), asc(member.id));
  return rows.map((row) => ({ ...row, status: asStatus(row.status) }));
}

export interface RequestClerkSetupApprovalRequest {
  workspaceId: string;
  /** The clerk asking; only an active clerk of the workspace may. */
  actorUserId: string;
}

/**
 * The clerk marks their setup done and waits for the senior. Idempotent: an already pending or
 * approved setup is returned unchanged. `FORBIDDEN` for anyone who is not an active clerk here.
 */
export async function requestClerkSetupApproval(
  db: Queryable,
  request: RequestClerkSetupApprovalRequest,
): Promise<ClerkSetup> {
  return db.transaction(async (tx) => {
    const [own] = await tx
      .select({ id: member.id, role: member.role, status: member.clerkSetupStatus })
      .from(member)
      .where(
        and(
          eq(member.organizationId, request.workspaceId),
          eq(member.userId, request.actorUserId),
          activeMember,
        ),
      )
      .for('update');
    if (!own || own.role !== 'clerk') throw forbidden();
    if (own.status === null) {
      await tx.update(member).set({ clerkSetupStatus: 'pending' }).where(eq(member.id, own.id));
    }
    const entry = (await getClerkSetup(tx, request.workspaceId)).find((c) => c.memberId === own.id);
    if (!entry) throw forbidden();
    return entry;
  });
}

export interface ApproveClerkSetupRequest {
  workspaceId: string;
  actorUserId: string;
  /** The clerk's member id. */
  memberId: string;
  now?: Date | undefined;
}

const NOTHING_WAITING = 'That clerk has no setup waiting for approval';

/**
 * The senior approves a clerk's setup. Needs `workspace.manage` (advocate and above); the target
 * must be an active clerk of this workspace who has asked for approval (`CONFLICT` otherwise; an
 * already approved setup is returned as is).
 */
export async function approveClerkSetup(
  db: Queryable,
  request: ApproveClerkSetupRequest,
): Promise<ClerkSetup> {
  return db.transaction(async (tx) => {
    await requireCan(tx, request.workspaceId, request.actorUserId, 'workspace.manage');
    const [target] = await tx
      .select({ id: member.id, status: member.clerkSetupStatus })
      .from(member)
      .where(
        and(
          eq(member.id, request.memberId),
          eq(member.organizationId, request.workspaceId),
          eq(member.role, 'clerk'),
          activeMember,
        ),
      )
      .for('update');
    if (!target || target.status === null) throw conflict(NOTHING_WAITING);
    if (target.status === 'pending') {
      await tx
        .update(member)
        .set({ clerkSetupStatus: 'approved', clerkSetupDecidedAt: request.now ?? new Date() })
        .where(eq(member.id, target.id));
    }
    const entry = (await getClerkSetup(tx, request.workspaceId)).find(
      (c) => c.memberId === target.id,
    );
    if (!entry) throw conflict(NOTHING_WAITING);
    return entry;
  });
}
