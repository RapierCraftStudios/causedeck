// Members added without an invitation (#684, part of #508): SCIM provisioning creates the user and
// an active membership at once, and deactivation suspends or removes it. The caller has already
// authenticated (a SCIM token, or a member holding `member.invite`), so nothing here looks at an
// actor; the role is never `owner`, and the billing seat gate runs before a seat is taken.
import { isRole } from '@causedeck/auth/policy';
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import { conflict, invalid, notFound } from './errors.ts';
import { entitlements } from './members.ts';

type Queryable = Database | Transaction;
type WorkspaceRole = (typeof schema.member.$inferSelect)['role'];

const { member, organization, session, user } = schema;

export interface ProvisionedMember {
  userId: string;
  memberId: string;
  /** `added`: a new seat; `reactivated`: a suspended or removed member came back; `exists`: no change. */
  outcome: 'added' | 'reactivated' | 'exists';
}

export interface AddProvisionedMemberRequest {
  workspaceId: string;
  email: string;
  name?: string | undefined;
  role: WorkspaceRole;
}

/**
 * Find or create the user for `email` and make them an active member with `role`. An active member
 * is left as is (`exists`); a suspended or removed one is reactivated with `role`. Run it inside the
 * workspace scope.
 */
export async function addProvisionedMember(
  db: Queryable,
  request: AddProvisionedMemberRequest,
): Promise<ProvisionedMember> {
  const email = request.email.trim().toLowerCase();
  if (!email.includes('@')) throw invalid('A valid email address is required');
  if (!isRole(request.role) || request.role === 'owner') {
    throw invalid('Provisioned members cannot be owners');
  }
  const name = request.name?.trim() || email.split('@')[0] || email;

  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(and(eq(organization.id, request.workspaceId), sql`${organization.deletedAt} is null`))
      .for('update');
    if (!workspace) throw notFound();

    await tx.insert(user).values({ name, email }).onConflictDoNothing({ target: user.email });
    const [account] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(sql`lower(${user.email})`, email));
    if (!account) throw new Error('provisioned user lookup returned no row');

    const [existing] = await tx
      .select({ id: member.id, status: member.status, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, request.workspaceId), eq(member.userId, account.id)));
    if (existing?.status === 'active') {
      return { userId: account.id, memberId: existing.id, outcome: 'exists' as const };
    }
    await entitlements.assertCanAddSeat(tx, request.workspaceId, request.role);
    if (existing) {
      await tx
        .update(member)
        .set({ status: 'active', role: request.role, roleGrantedAt: sql`now()` })
        .where(eq(member.id, existing.id));
      return { userId: account.id, memberId: existing.id, outcome: 'reactivated' as const };
    }
    const [row] = await tx
      .insert(member)
      .values({ organizationId: request.workspaceId, userId: account.id, role: request.role })
      .returning({ id: member.id });
    if (!row) throw new Error('provisioned member insert returned no row');
    return { userId: account.id, memberId: row.id, outcome: 'added' as const };
  });
}

export interface DeactivateProvisionedMemberRequest {
  workspaceId: string;
  userId: string;
  /** `true` marks the member `removed` (SCIM DELETE); otherwise `suspended` (SCIM `active: false`). */
  remove?: boolean | undefined;
}

/**
 * End a member's access: workspace sessions are revoked and the status becomes `suspended` or
 * `removed`. Owners are never deprovisioned this way (`CONFLICT`). Open work stays assigned.
 */
export async function deactivateProvisionedMember(
  db: Queryable,
  request: DeactivateProvisionedMemberRequest,
): Promise<{ memberId: string; userId: string }> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: member.id, role: member.role, status: member.status })
      .from(member)
      .where(
        and(eq(member.organizationId, request.workspaceId), eq(member.userId, request.userId)),
      )
      .for('update');
    if (!target || target.status === 'removed') throw notFound('Member not found');
    if (target.role === 'owner') throw conflict('An owner cannot be deprovisioned');
    await tx
      .delete(session)
      .where(
        and(eq(session.userId, request.userId), eq(session.activeOrganizationId, request.workspaceId)),
      );
    await tx
      .update(member)
      .set({ status: request.remove === true ? 'removed' : 'suspended' })
      .where(eq(member.id, target.id));
    return { memberId: target.id, userId: request.userId };
  });
}
