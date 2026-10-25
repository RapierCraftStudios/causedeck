// Invitations (#178, #18): invite, reissue, revoke and accept. A token is 32 random bytes sent once
// by email; only its SHA-256 is stored. Invitations last 7 days, are single-use and revocable.
// Inviting never looks at whether the email has an account, so the response cannot reveal it.
import { createHash, randomBytes } from 'node:crypto';

import type { Mailer } from '@causedeck/auth/mailer';
import { AUTH_EMAIL_KEYS, type AuthLocale } from '@causedeck/auth/messages';
import { invitableRoles, isRole } from '@causedeck/auth/policy';
import { consumeRateLimit } from '@causedeck/auth/rate-limit';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { InviteInput } from '@causedeck/validators/workspace';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { recordActivation } from '../activation/index.ts';
import {
  conflict,
  forbidden,
  invalid,
  InvitationError,
  notFound,
  rateLimited,
  type InvitationErrorReason,
} from './errors.ts';
import { entitlements } from './members.ts';
import { getRoleSettings, toPolicySettings } from './role-settings.ts';

type Queryable = Database | Transaction;
type WorkspaceRole = (typeof schema.member.$inferSelect)['role'];

const { invitation, member, organization, user } = schema;

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_RATE_LIMIT = { max: 20, windowSeconds: 60 * 60 } as const;
export const ACCEPT_RATE_LIMIT = { max: 20, windowSeconds: 60 * 60 } as const;

/** 32 random bytes, base64url: the only copy of the token is the one in the email. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** `consumeRateLimit` only inserts, which a transaction can do as well as the root client. */
async function withinLimit(
  db: Queryable,
  key: string,
  limit: { max: number; windowSeconds: number },
  now: Date,
): Promise<void> {
  if (!(await consumeRateLimit(db as Database, key, limit, now.getTime()))) throw rateLimited();
}

/** Lock the live workspace and check the actor may invite `role` into it. */
async function requireInviter(
  tx: Queryable,
  workspaceId: string,
  actorUserId: string,
  role: WorkspaceRole,
): Promise<void> {
  const [workspace] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(and(eq(organization.id, workspaceId), isNull(organization.deletedAt)))
    .for('update');
  if (!workspace) throw notFound();
  const [actor] = await tx
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.userId, actorUserId),
        eq(member.status, 'active'),
      ),
    );
  // The policy decides (#234): `member.invite`, granting only roles ranked below the inviter's,
  // and none to advocates while the workspace turns `advocates_can_invite` off (#285).
  const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
  if (
    !actor ||
    !isRole(actor.role) ||
    !isRole(role) ||
    !invitableRoles(actor.role, settings).includes(role)
  ) {
    throw forbidden('You cannot invite members with this role');
  }
}

export interface InvitationSummary {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: Date;
}

export interface IssuedInvitation {
  invitation: InvitationSummary;
  /** The plaintext token, for the dev-only "Copy link"; it is never stored. */
  token: string;
}

interface SendOptions {
  mailer: Mailer;
  /** Origin the `/invite/<token>` link is built on (`APP_URL`). */
  appUrl: string;
  locale?: AuthLocale | undefined;
  now?: Date | undefined;
}

const summaryColumns = {
  id: invitation.id,
  workspaceId: invitation.organizationId,
  email: invitation.email,
  role: invitation.role,
  expiresAt: invitation.expiresAt,
};

async function sendInvitation(
  { mailer, appUrl, locale = 'en' }: SendOptions,
  issued: IssuedInvitation,
): Promise<void> {
  await mailer.send({
    to: issued.invitation.email,
    template: 'workspace.invitation',
    subjectKey: AUTH_EMAIL_KEYS.invitation.subject,
    bodyKey: AUTH_EMAIL_KEYS.invitation.body,
    url: new URL(`/invite/${issued.token}`, appUrl).toString(),
    locale,
    expiresInMinutes: INVITATION_TTL_MS / 60_000,
  });
}

export interface InviteMemberRequest extends SendOptions {
  workspaceId: string;
  actorUserId: string;
  input: InviteInput;
  /**
   * Skip the per-actor hourly cap (`INVITE_RATE_LIMIT`). Only for bulk callers that cap their own
   * batch (CSV provisioning, #684); the role and seat checks still apply.
   */
  bypassRateLimit?: boolean | undefined;
}

/**
 * Invite `input.email` with `input.role` (never `owner`). Owners invite any other role; advocates
 * invite juniors, clerks and viewers. Re-inviting an email with a pending invitation reissues it:
 * same row, new token and expiry, so the old link stops working.
 */
export async function inviteMember(
  db: Queryable,
  request: InviteMemberRequest,
): Promise<IssuedInvitation> {
  const parsed = InviteInput.safeParse(request.input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid invitation');
  const { email, role } = parsed.data;
  const now = request.now ?? new Date();

  const issued = await db.transaction(async (tx) => {
    await requireInviter(tx, request.workspaceId, request.actorUserId, role);
    if (request.bypassRateLimit !== true) {
      await withinLimit(
        tx,
        `invite:${request.workspaceId}:${request.actorUserId}`,
        INVITE_RATE_LIMIT,
        now,
      );
    }
    await entitlements.assertCanAddSeat(tx, request.workspaceId, role);

    const token = generateInvitationToken();
    const values = {
      role,
      inviterId: request.actorUserId,
      tokenHash: hashInvitationToken(token),
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      status: 'pending',
    };
    const [pending] = await tx
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, request.workspaceId),
          eq(sql`lower(${invitation.email})`, email),
          isNull(invitation.acceptedAt),
          isNull(invitation.revokedAt),
        ),
      )
      .orderBy(desc(invitation.createdAt))
      .limit(1)
      .for('update');
    const [row] = pending
      ? await tx
          .update(invitation)
          .set(values)
          .where(eq(invitation.id, pending.id))
          .returning(summaryColumns)
      : await tx
          .insert(invitation)
          .values({ ...values, organizationId: request.workspaceId, email })
          .returning(summaryColumns);
    if (!row) throw new Error('invitation write returned no row');
    return { invitation: row, token };
  });

  await sendInvitation(request, issued);
  // The inviter's `invite_sent` step (#509); measurement never fails the invitation.
  await recordActivation(db, { userId: request.actorUserId, step: 'invite_sent', at: now });
  return issued;
}

export interface ReissueInvitationRequest extends SendOptions {
  workspaceId: string;
  actorUserId: string;
  invitationId: string;
}

async function pendingInvitation(tx: Queryable, workspaceId: string, invitationId: string) {
  const [row] = await tx
    .select(summaryColumns)
    .from(invitation)
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.organizationId, workspaceId),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
      ),
    )
    .for('update');
  if (!row) throw notFound('Invitation not found');
  return row;
}

/** Rotate a pending invitation's token and expiry and send it again. */
export async function reissueInvitation(
  db: Queryable,
  request: ReissueInvitationRequest,
): Promise<IssuedInvitation> {
  const now = request.now ?? new Date();
  const issued = await db.transaction(async (tx) => {
    const pending = await pendingInvitation(tx, request.workspaceId, request.invitationId);
    await requireInviter(tx, request.workspaceId, request.actorUserId, pending.role);
    await withinLimit(
      tx,
      `invite:${request.workspaceId}:${request.actorUserId}`,
      INVITE_RATE_LIMIT,
      now,
    );
    const token = generateInvitationToken();
    const [row] = await tx
      .update(invitation)
      .set({
        tokenHash: hashInvitationToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        inviterId: request.actorUserId,
        status: 'pending',
      })
      .where(eq(invitation.id, pending.id))
      .returning(summaryColumns);
    if (!row) throw new Error('invitation update returned no row');
    return { invitation: row, token };
  });

  await sendInvitation(request, issued);
  return issued;
}

export interface RevokeInvitationRequest {
  workspaceId: string;
  actorUserId: string;
  invitationId: string;
  now?: Date | undefined;
}

/** Revoke a pending invitation; its link then fails with `REVOKED`. */
export async function revokeInvitation(
  db: Queryable,
  request: RevokeInvitationRequest,
): Promise<void> {
  await db.transaction(async (tx) => {
    const pending = await pendingInvitation(tx, request.workspaceId, request.invitationId);
    await requireInviter(tx, request.workspaceId, request.actorUserId, pending.role);
    await tx
      .update(invitation)
      .set({ revokedAt: request.now ?? new Date(), status: 'canceled' })
      .where(eq(invitation.id, pending.id));
  });
}

export interface PendingInvitation extends InvitationSummary {
  invitedAt: Date;
}

/**
 * Invitations of a live workspace still waiting for an answer (not accepted, revoked or expired),
 * oldest first. The members page lists them next to members with `Resend` and `Revoke`.
 */
export async function listPendingInvitations(
  db: Queryable,
  workspaceId: string,
  now: Date = new Date(),
): Promise<PendingInvitation[]> {
  return db
    .select({ ...summaryColumns, invitedAt: invitation.createdAt })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(
      and(
        eq(invitation.organizationId, workspaceId),
        isNull(organization.deletedAt),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
        gt(invitation.expiresAt, now),
      ),
    )
    .orderBy(asc(invitation.createdAt), asc(invitation.id));
}

/**
 * The workspace of the invitation `token` belongs to, or `null`. Looked up by token hash through a
 * SECURITY DEFINER function (0006_rls_baseline), because the invitee has no workspace scope yet;
 * the invitation itself is then read inside that workspace's scope.
 */
async function invitationWorkspace(db: Queryable, token: string): Promise<string | null> {
  const [row] = await db.execute<{ workspace_id: string | null }>(
    sql`select app_invitation_workspace(${hashInvitationToken(token)})::text as workspace_id`,
  );
  return row?.workspace_id ?? null;
}

/** The invitation row and its workspace slug, as `acceptInvitation` and `previewInvitation` read it. */
const invitationColumns = {
  id: invitation.id,
  workspaceId: invitation.organizationId,
  workspaceSlug: organization.slug,
  email: invitation.email,
  role: invitation.role,
  expiresAt: invitation.expiresAt,
  acceptedAt: invitation.acceptedAt,
  revokedAt: invitation.revokedAt,
};

export interface AcceptInvitationRequest {
  userId: string;
  token: string;
  now?: Date | undefined;
}

export interface AcceptedInvitation {
  memberId: string;
  workspaceId: string;
  /** The workspace's current slug, so the caller can land the new member on it. */
  workspaceSlug: string;
  role: WorkspaceRole;
}

/**
 * Accept an invitation as the signed-in `userId`, whose email must match. Failures are distinct
 * `InvitationError` reasons: `INVALID`, `REVOKED`, `USED`, `EXPIRED`, `EMAIL_MISMATCH`.
 */
export async function acceptInvitation(
  db: Queryable,
  request: AcceptInvitationRequest,
): Promise<AcceptedInvitation> {
  const now = request.now ?? new Date();
  await withinLimit(db, `invite-accept:${request.userId}`, ACCEPT_RATE_LIMIT, now);

  const workspaceId = await invitationWorkspace(db, request.token);
  if (workspaceId === null) throw new InvitationError('INVALID');
  return withWorkspace(db, { workspaceId, userId: request.userId }, async (tx) => {
    const [found] = await tx
      .select({
        ...invitationColumns,
      })
      .from(invitation)
      .innerJoin(organization, eq(organization.id, invitation.organizationId))
      .where(
        and(
          eq(invitation.tokenHash, hashInvitationToken(request.token)),
          isNull(organization.deletedAt),
        ),
      )
      .for('update', { of: invitation });
    if (!found) throw new InvitationError('INVALID');
    if (found.revokedAt !== null) throw new InvitationError('REVOKED');
    if (found.acceptedAt !== null) throw new InvitationError('USED');
    if (found.expiresAt.getTime() <= now.getTime()) throw new InvitationError('EXPIRED');

    const [account] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, request.userId));
    if (!account) throw notFound('User not found');
    if (account.email.trim().toLowerCase() !== found.email.trim().toLowerCase()) {
      throw new InvitationError('EMAIL_MISMATCH');
    }

    const [existing] = await tx
      .select({ id: member.id, status: member.status })
      .from(member)
      .where(and(eq(member.organizationId, found.workspaceId), eq(member.userId, request.userId)))
      .for('update');
    if (existing?.status === 'active') throw conflict('You are already a member of this workspace');

    await entitlements.assertCanAddSeat(tx, found.workspaceId, found.role);
    const [joined] = existing
      ? await tx
          .update(member)
          .set({ status: 'active', role: found.role, joinedAt: now, roleGrantedAt: now })
          .where(eq(member.id, existing.id))
          .returning({ id: member.id })
      : await tx
          .insert(member)
          .values({ organizationId: found.workspaceId, userId: request.userId, role: found.role })
          .returning({ id: member.id });
    if (!joined) throw new Error('membership write returned no row');

    await tx
      .update(invitation)
      .set({ acceptedAt: now, status: 'accepted' })
      .where(eq(invitation.id, found.id));
    return {
      memberId: joined.id,
      workspaceId: found.workspaceId,
      workspaceSlug: found.workspaceSlug,
      role: found.role,
    };
  });
}

/** What the `/invite/<token>` page shows: accept, or why the invitation cannot be accepted. */
export type InvitationPreviewState = 'VALID' | InvitationErrorReason | 'ALREADY_MEMBER';

export interface InvitationPreview {
  state: InvitationPreviewState;
  /** Set for every state except `INVALID`; the invited email is never returned. */
  workspaceName?: string;
  workspaceSlug?: string;
  role?: WorkspaceRole;
}

export interface PreviewInvitationRequest {
  userId: string;
  token: string;
  now?: Date | undefined;
}

/**
 * Read-only look at an invitation for the signed-in `userId`: the same checks, in the same order,
 * as `acceptInvitation`, without locking, writing or consuming the accept rate limit.
 */
export async function previewInvitation(
  db: Queryable,
  request: PreviewInvitationRequest,
): Promise<InvitationPreview> {
  const now = request.now ?? new Date();
  const workspaceId = await invitationWorkspace(db, request.token);
  if (workspaceId === null) return { state: 'INVALID' };
  return withWorkspace(db, { workspaceId, userId: request.userId }, (tx) =>
    previewInScope(tx, request, now),
  );
}

async function previewInScope(
  db: Transaction,
  request: PreviewInvitationRequest,
  now: Date,
): Promise<InvitationPreview> {
  const [found] = await db
    .select({ ...invitationColumns, workspaceName: organization.name })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(
      and(
        eq(invitation.tokenHash, hashInvitationToken(request.token)),
        isNull(organization.deletedAt),
      ),
    );
  if (!found) return { state: 'INVALID' };
  const details = {
    workspaceName: found.workspaceName,
    workspaceSlug: found.workspaceSlug,
    role: found.role,
  };
  if (found.revokedAt !== null) return { state: 'REVOKED', ...details };
  if (found.acceptedAt !== null) return { state: 'USED', ...details };
  if (found.expiresAt.getTime() <= now.getTime()) return { state: 'EXPIRED', ...details };

  const [account] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, request.userId));
  if (!account || account.email.trim().toLowerCase() !== found.email.trim().toLowerCase()) {
    return { state: 'EMAIL_MISMATCH', ...details };
  }
  const [existing] = await db
    .select({ status: member.status })
    .from(member)
    .where(and(eq(member.organizationId, found.workspaceId), eq(member.userId, request.userId)));
  return { state: existing?.status === 'active' ? 'ALREADY_MEMBER' : 'VALID', ...details };
}
