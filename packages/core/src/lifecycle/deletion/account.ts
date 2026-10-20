// Account deletion (#303, part 3 of #31; docs/engineering/data-lifecycle.md "Account deletion").
//
// - `requestAccountDeletion`: the user's own account. Refused (`CONFLICT`) while the user is the
//   only active owner of any live workspace (transfer ownership or delete the workspace first),
//   and for platform staff accounts (removed by the operator). Otherwise one `deletion_job`
//   (`kind` `account`, no workspace, read and written through the `account_self` policy) is
//   scheduled with `account.deletion_requested` (account chain, fail-closed) in the same
//   transaction, and `account.delete` is enqueued with ids only. No cool-off: that is for
//   workspace deletion only (#302); step-up authentication gates the entry point (#304).
// - `runAccountDeletion`: the job body. It re-checks the blocks (ownership can change while the
//   job waits), strips the user from `matter_restriction.allowed_user_ids` in each workspace,
//   then in one transaction deletes the `user` row (cascading sessions, accounts, passkeys,
//   two-factor, memberships, invitations, notification prefs, exports and idempotency keys; the
//   workspace's files, restrictions and flag overrides keep their rows with the user set to null,
//   0030) and anonymises the user's audit events (`app_audit_anonymise_actor`: `actor_user_id`
//   becomes null, the chain hashes `actor_ref` and stays valid, and the salt is deleted so the ref
//   cannot be recomputed). Idempotent: an erased job is a no-op, and every step can be rerun.
//
// Audit events written here never name the user in `target_id` or metadata; `account.deleted` is a
// system event (a user actor would create a new salt and so a new, linkable ref).
import { schema, withUser, withWorkspace, type Queryable } from '@causedeck/db';
import type { DeletionStatus } from '@causedeck/db/schema';
import type { Logger } from '@causedeck/observability';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { record } from '../../audit/index.ts';
import { conflict, listMemberships } from '../../workspaces/index.ts';

const { deletionJob, matterRestriction, member, staffUser, user } = schema;

/** Why an account deletion job ended as `failed` (`steps.error`). */
export const ACCOUNT_DELETION_ERRORS = ['sole_owner', 'staff_account'] as const;
export type AccountDeletionError = (typeof ACCOUNT_DELETION_ERRORS)[number];

/** The message a sole owner sees; the workspace names follow it. */
export const ACCOUNT_DELETION_SOLE_OWNER_MESSAGE =
  'You are the only owner of a workspace. Transfer ownership or delete the workspace before deleting your account';

export const ACCOUNT_DELETION_STAFF_MESSAGE =
  'Platform staff accounts are removed by the operator, not deleted from the account page';

export interface AccountDeletionJob {
  id: string;
  status: DeletionStatus;
  createdAt: Date;
  completedAt: Date | null;
}

export interface AccountDeletionCtx {
  db: Queryable;
  userId: string;
  requestId?: string;
  userAgent?: string;
  ip?: string;
  now?: () => Date;
}

export interface RequestAccountDeletionDeps {
  /** Enqueue `account.delete` (ids only); `requestAccountDeletionFor` in `@causedeck/core/runtime`. */
  enqueue: (job: { userId: string; jobId: string }) => Promise<unknown>;
}

export interface SoleOwnedWorkspace {
  workspaceId: string;
  name: string;
  slug: string;
}

type Row = typeof deletionJob.$inferSelect;

const toJob = (row: Row): AccountDeletionJob => ({
  id: row.id,
  status: row.status,
  createdAt: row.createdAt,
  completedAt: row.completedAt,
});

const userAudit = (ctx: AccountDeletionCtx, db: Queryable) => ({
  db,
  workspaceId: null,
  actor: { userId: ctx.userId, kind: 'user' as const },
  ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
  ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
  ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
});

const systemAudit = (db: Queryable) => ({
  db,
  workspaceId: null,
  actor: { userId: null, kind: 'system' as const },
});

/**
 * Live workspaces where `userId` is an active owner and no other active owner exists. Each count
 * runs in that workspace's own scope, so call this outside any workspace transaction.
 */
export async function soleOwnedWorkspaces(
  db: Queryable,
  userId: string,
): Promise<SoleOwnedWorkspace[]> {
  const owned = (await listMemberships(db, userId)).filter((m) => m.role === 'owner');
  const sole: SoleOwnedWorkspace[] = [];
  for (const m of owned) {
    const owners = await withWorkspace(db, { workspaceId: m.workspaceId }, (tx) =>
      tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, m.workspaceId),
            eq(member.role, 'owner'),
            eq(member.status, 'active'),
          ),
        ),
    );
    if (owners.length <= 1) sole.push({ workspaceId: m.workspaceId, name: m.name, slug: m.slug });
  }
  return sole;
}

async function isStaff(db: Queryable, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: staffUser.userId })
    .from(staffUser)
    .where(eq(staffUser.userId, userId));
  return row !== undefined;
}

function soleOwnerError(workspaces: readonly SoleOwnedWorkspace[]) {
  return conflict(
    `${ACCOUNT_DELETION_SOLE_OWNER_MESSAGE}: ${workspaces.map((w) => w.name).join(', ')}`,
  );
}

/** Request the deletion of the caller's own account. */
export async function requestAccountDeletion(
  ctx: AccountDeletionCtx,
  deps: RequestAccountDeletionDeps,
): Promise<AccountDeletionJob> {
  if (await withUser(ctx.db, { userId: ctx.userId }, (tx) => isStaff(tx, ctx.userId))) {
    throw conflict(ACCOUNT_DELETION_STAFF_MESSAGE);
  }
  const sole = await soleOwnedWorkspaces(ctx.db, ctx.userId);
  if (sole.length > 0) {
    await withUser(ctx.db, { userId: ctx.userId }, (tx) =>
      record(userAudit(ctx, tx), {
        action: 'account.deletion_blocked',
        outcome: 'denied',
        metadata: { reason: 'sole_owner', workspaces: sole.length },
      }),
    );
    throw soleOwnerError(sole);
  }
  const { job, created } = await withUser(ctx.db, { userId: ctx.userId }, async (tx) => {
    const [active] = await tx
      .select()
      .from(deletionJob)
      .where(
        and(
          eq(deletionJob.kind, 'account'),
          eq(deletionJob.userId, ctx.userId),
          inArray(deletionJob.status, ['scheduled', 'running']),
        ),
      )
      .limit(1);
    if (active !== undefined) return { job: active, created: false };
    const now = ctx.now?.() ?? new Date();
    const [row] = await tx
      .insert(deletionJob)
      .values({
        workspaceId: null,
        userId: ctx.userId,
        kind: 'account',
        requestedBy: ctx.userId,
        status: 'scheduled',
        eraseAfter: now,
        createdAt: now,
      })
      .returning();
    if (row === undefined) throw new Error('requestAccountDeletion: insert returned no row');
    await record(userAudit(ctx, tx), { action: 'account.deletion_requested' });
    return { job: row, created: true };
  });
  if (created) await deps.enqueue({ userId: ctx.userId, jobId: job.id });
  return toJob(job);
}

export interface AccountDeletionRunCtx {
  db: Queryable;
  log: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
}

export interface AccountDeletionOutcome {
  status: 'erased' | 'already-erased' | 'failed' | 'missing';
  /** Audit events anonymised by this run. */
  anonymised: number;
  error?: AccountDeletionError;
}

async function loadJob(db: Queryable, userId: string, jobId: string): Promise<Row | undefined> {
  const [row] = await withUser(db, { userId }, (tx) =>
    tx
      .select()
      .from(deletionJob)
      .where(
        and(
          eq(deletionJob.id, jobId),
          eq(deletionJob.kind, 'account'),
          eq(deletionJob.userId, userId),
        ),
      ),
  );
  return row;
}

async function updateJob(
  db: Queryable,
  userId: string,
  jobId: string,
  set: Partial<Pick<Row, 'status' | 'steps' | 'completedAt'>>,
): Promise<void> {
  await withUser(db, { userId }, (tx) =>
    tx.update(deletionJob).set(set).where(eq(deletionJob.id, jobId)),
  );
}

/** The `account.delete` job body: delete the account and anonymise its audit attribution. */
export async function runAccountDeletion(
  ctx: AccountDeletionRunCtx,
  { userId, jobId }: { userId: string; jobId: string },
): Promise<AccountDeletionOutcome> {
  const job = await loadJob(ctx.db, userId, jobId);
  if (job === undefined) return { status: 'missing', anonymised: 0 };
  if (job.status === 'erased') return { status: 'already-erased', anonymised: 0 };
  if (job.status !== 'scheduled' && job.status !== 'running') {
    return { status: job.status === 'failed' ? 'failed' : 'missing', anonymised: 0 };
  }
  const now = () => ctx.now?.() ?? new Date();
  const steps: Record<string, unknown> = { ...job.steps, startedAt: now().toISOString() };
  await updateJob(ctx.db, userId, jobId, { status: 'running', steps });

  const fail = async (error: AccountDeletionError): Promise<AccountDeletionOutcome> => {
    await withUser(ctx.db, { userId }, async (tx) => {
      await tx
        .update(deletionJob)
        .set({ status: 'failed', steps: { ...steps, error } })
        .where(eq(deletionJob.id, jobId));
      await record(systemAudit(tx), {
        action: 'account.deletion_blocked',
        outcome: 'denied',
        target: { kind: 'deletion_job', id: jobId },
        metadata: { reason: error },
      });
    });
    ctx.log.warn({ jobId, error }, 'account deletion blocked');
    return { status: 'failed', anonymised: 0, error };
  };

  if (await withUser(ctx.db, { userId }, (tx) => isStaff(tx, userId))) return fail('staff_account');
  if ((await soleOwnedWorkspaces(ctx.db, userId)).length > 0) return fail('sole_owner');

  // Every workspace the user has a membership row in (any status), through `member_self`.
  const workspaces = await withUser(ctx.db, { userId }, (tx) =>
    tx.select({ id: member.organizationId }).from(member).where(eq(member.userId, userId)),
  );
  for (const { id: workspaceId } of workspaces) {
    await withWorkspace(ctx.db, { workspaceId }, (tx) =>
      tx
        .update(matterRestriction)
        .set({
          allowedUserIds: sql`array_remove(${matterRestriction.allowedUserIds}, ${userId}::uuid)`,
        })
        .where(sql`${userId}::uuid = any(${matterRestriction.allowedUserIds})`),
    );
  }
  steps.restrictions = { workspaces: workspaces.length, at: now().toISOString() };
  await updateJob(ctx.db, userId, jobId, { steps });

  let anonymised: number;
  try {
    anonymised = await eraseAccount(ctx, userId, jobId, steps, workspaces.length);
  } catch (error) {
    // A staff-only reference (feature flags, access modes, support sessions, budget overrides)
    // still names the user: the operator removes those accounts.
    if (isForeignKeyViolation(error)) return fail('staff_account');
    throw error;
  }
  ctx.log.info({ jobId, anonymised }, 'account deleted');
  return { status: 'erased', anonymised };
}

/** True for a Postgres foreign key violation, raw or wrapped by Drizzle (`cause`). */
function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (code === '23503') return true;
    current = cause;
  }
  return false;
}

/** Delete the user and anonymise its audit events, in one transaction; the job becomes `erased`. */
function eraseAccount(
  ctx: AccountDeletionRunCtx,
  userId: string,
  jobId: string,
  steps: Record<string, unknown>,
  workspaces: number,
): Promise<number> {
  const now = () => ctx.now?.() ?? new Date();
  return withUser(ctx.db, { userId }, async (tx) => {
    await tx.delete(user).where(eq(user.id, userId));
    const [row] = await tx.execute<{ n: number }>(
      sql`select app_audit_anonymise_actor(${userId}::uuid)::int as n`,
    );
    const n = row?.n ?? 0;
    await record(systemAudit(tx), {
      action: 'account.deleted',
      target: { kind: 'deletion_job', id: jobId },
      metadata: { anonymised: n, workspaces },
    });
    const at = now();
    await tx
      .update(deletionJob)
      .set({
        status: 'erased',
        completedAt: at,
        steps: { ...steps, erased: { at: at.toISOString(), anonymised: n } },
      })
      .where(eq(deletionJob.id, jobId));
    return n;
  });
}
