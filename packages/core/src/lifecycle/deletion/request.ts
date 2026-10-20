// Workspace deletion requests (#302, part 2 of #31; docs/engineering/data-lifecycle.md).
//
// - `requestWorkspaceDeletion`: owners only, and only after typing the workspace's exact name.
//   Starts a 14-day `pending_cooloff` (`cooloff_until = erase_after = now + 14 d`); nothing is
//   erased before then. One active deletion per workspace: a second request returns the pending one
//   (`deletion_job_workspace_active_uq` is the backstop). Records `workspace.deletion_requested`
//   (fail-closed) in the same transaction, then notifies every active owner (`security.alert`).
// - `cancelWorkspaceDeletion`: any owner, while the job is pending or scheduled (not once the erase
//   is running). Records `workspace.deletion_cancelled` and notifies the owners.
// - `getActiveWorkspaceDeletion`: the pending, scheduled or running deletion of the current
//   workspace, for the cool-off banner (#305): active members only, null for anyone else.
// Metadata and logs hold ids and dates only; step-up authentication (#304) wraps these calls.
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import type { DeletionStatus } from '@causedeck/db/schema';
import { notify, type DeliveryJob } from '@causedeck/notifications';
import { createLogger, type Logger } from '@causedeck/observability';
import { and, eq, inArray } from 'drizzle-orm';

import { record } from '../../audit/index.ts';
import { notFound, requireOwner, WorkspaceError } from '../../workspaces/index.ts';

import { DELETION_COOLOFF_MS } from './cooloff.ts';

const { deletionJob, member, organization } = schema;

/** Statuses of a deletion that is still in progress (at most one per workspace). */
export const ACTIVE_DELETION_STATUSES = ['pending_cooloff', 'scheduled', 'running'] as const;

export interface DeletionJob {
  id: string;
  workspaceId: string;
  requestedBy: string;
  status: DeletionStatus;
  cooloffUntil: Date | null;
  eraseAfter: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}

export type DeletionErrorReason = 'CONFIRM_NAME_MISMATCH' | 'DELETION_NOT_CANCELLABLE';

const DELETION_ERRORS: Record<
  DeletionErrorReason,
  { code: 'VALIDATION' | 'CONFLICT'; message: string }
> = {
  CONFIRM_NAME_MISMATCH: {
    code: 'VALIDATION',
    message: 'Type the workspace name exactly to confirm deletion',
  },
  DELETION_NOT_CANCELLABLE: {
    code: 'CONFLICT',
    message: 'This deletion can no longer be cancelled',
  },
};

/** A `WorkspaceError` (same `name`, so action mapping is unchanged) with a typed `reason`. */
export class DeletionError extends WorkspaceError {
  readonly reason: DeletionErrorReason;

  constructor(reason: DeletionErrorReason) {
    const { code, message } = DELETION_ERRORS[reason];
    super(code, message);
    this.reason = reason;
  }
}

export interface DeletionRequestCtx {
  db: Queryable;
  workspaceId: string;
  userId: string;
  requestId?: string;
  userAgent?: string;
  ip?: string;
  now?: () => Date;
}

export interface DeletionNotifyDeps {
  /**
   * Sends one `notification.deliver` job. The job lives in the `jobs` domain, which depends on this
   * one, so the caller passes it in (a `@causedeck/core/runtime` wrapper, #305).
   */
  enqueueDelivery: (job: DeliveryJob) => Promise<unknown>;
  log?: Pick<Logger, 'warn'>;
}

type Row = typeof deletionJob.$inferSelect;

function toJob(row: Row): DeletionJob {
  return {
    id: row.id,
    // Workspace deletions always have a workspace (deletion_job_workspace_chk).
    workspaceId: row.workspaceId ?? '',
    requestedBy: row.requestedBy,
    status: row.status,
    cooloffUntil: row.cooloffUntil,
    eraseAfter: row.eraseAfter,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

const scopeOf = (ctx: DeletionRequestCtx) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

const auditCtx = (ctx: DeletionRequestCtx, db: Queryable) => ({
  db,
  workspaceId: ctx.workspaceId,
  actor: { userId: ctx.userId, kind: 'user' as const },
  ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
  ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
  ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
});

const activeWorkspaceDeletion = (workspaceId: string) =>
  and(
    eq(deletionJob.workspaceId, workspaceId),
    eq(deletionJob.kind, 'workspace'),
    inArray(deletionJob.status, [...ACTIVE_DELETION_STATUSES]),
  );

let log: Logger | undefined;
const logger = (): Logger => (log ??= createLogger({ service: 'lifecycle' }));

const dateLabel = (at: Date) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(at);

/** Owner notice copy (English, like the billing dunning notices). */
export function deletionNoticeCopy(
  kind: 'requested' | 'cancelled',
  { name, cooloffUntil }: { name: string; cooloffUntil: Date | null },
): { title: string; body: string } {
  if (kind === 'requested') {
    const on = cooloffUntil === null ? 'in 14 days' : `on ${dateLabel(cooloffUntil)}`;
    return {
      title: `${name} is scheduled for deletion`,
      body: `An owner asked to delete this workspace. It will be erased ${on}. Any owner can cancel before then.`,
    };
  }
  return {
    title: `Deletion of ${name} was cancelled`,
    body: 'An owner cancelled the scheduled deletion. Nothing was erased.',
  };
}

interface OwnerNotice {
  workspaceId: string;
  slug: string;
  name: string;
  owners: string[];
  jobId: string;
  cooloffUntil: Date | null;
}

async function ownersOf(tx: Queryable, workspaceId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.role, 'owner'),
        eq(member.status, 'active'),
      ),
    );
  return rows.map((r) => r.userId);
}

/** Notify every owner; a failed notice is logged (ids only) and never undoes the request. */
async function notifyOwners(
  db: Queryable,
  kind: 'requested' | 'cancelled',
  notice: OwnerNotice,
  deps: DeletionNotifyDeps,
): Promise<void> {
  const copy = deletionNoticeCopy(kind, notice);
  const ctx = { db, workspaceId: notice.workspaceId, enqueueDelivery: deps.enqueueDelivery };
  for (const userId of notice.owners) {
    try {
      await notify(ctx, {
        userId,
        category: 'security.alert',
        title: copy.title,
        body: copy.body,
        href: `/w/${notice.slug}/settings`,
        dedupeKey: `workspace-deletion:${notice.jobId}:${kind}`,
      });
    } catch (error) {
      (deps.log ?? logger()).warn(
        {
          workspaceId: notice.workspaceId,
          jobId: notice.jobId,
          userId,
          error: error instanceof Error ? error.name : 'NonError',
        },
        'workspace deletion notice failed',
      );
    }
  }
}

/** Request deletion of the current workspace: 14 days of cooling-off, then crypto-erase. */
export async function requestWorkspaceDeletion(
  ctx: DeletionRequestCtx,
  { confirmName }: { confirmName: string },
  deps: DeletionNotifyDeps,
): Promise<DeletionJob> {
  // Callers outside TypeScript (server actions parse input) could still pass anything.
  if (typeof confirmName !== 'string') throw new DeletionError('CONFIRM_NAME_MISMATCH');
  const result = await withWorkspace(ctx.db, scopeOf(ctx), async (tx) => {
    const workspace = await requireOwner(tx, ctx.workspaceId, ctx.userId);
    const [org] = await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, ctx.workspaceId));
    if (org === undefined) throw notFound();
    if (confirmName.trim() !== org.name) throw new DeletionError('CONFIRM_NAME_MISMATCH');
    const [active] = await tx
      .select()
      .from(deletionJob)
      .where(activeWorkspaceDeletion(ctx.workspaceId))
      .limit(1);
    if (active !== undefined) return { job: active, notice: null };
    const now = ctx.now?.() ?? new Date();
    const cooloffUntil = new Date(now.getTime() + DELETION_COOLOFF_MS);
    const [row] = await tx
      .insert(deletionJob)
      .values({
        workspaceId: ctx.workspaceId,
        kind: 'workspace',
        requestedBy: ctx.userId,
        status: 'pending_cooloff',
        cooloffUntil,
        eraseAfter: cooloffUntil,
        createdAt: now,
      })
      .returning();
    if (row === undefined) throw new Error('requestWorkspaceDeletion: insert returned no row');
    await record(auditCtx(ctx, tx), {
      action: 'workspace.deletion_requested',
      target: { kind: 'deletion_job', id: row.id },
      metadata: { jobId: row.id, cooloffUntil: cooloffUntil.toISOString() },
    });
    const notice: OwnerNotice = {
      workspaceId: ctx.workspaceId,
      slug: workspace.slug,
      name: org.name,
      owners: await ownersOf(tx, ctx.workspaceId),
      jobId: row.id,
      cooloffUntil,
    };
    return { job: row, notice };
  });
  if (result.notice !== null) await notifyOwners(ctx.db, 'requested', result.notice, deps);
  return toJob(result.job);
}

/** Cancel a pending (or scheduled, not yet running) deletion of the current workspace. */
export async function cancelWorkspaceDeletion(
  ctx: DeletionRequestCtx,
  jobId: string,
  deps: DeletionNotifyDeps,
): Promise<DeletionJob> {
  const result = await withWorkspace(ctx.db, scopeOf(ctx), async (tx) => {
    const workspace = await requireOwner(tx, ctx.workspaceId, ctx.userId);
    const [current] = await tx
      .select()
      .from(deletionJob)
      .where(
        and(
          eq(deletionJob.id, jobId),
          eq(deletionJob.workspaceId, ctx.workspaceId),
          eq(deletionJob.kind, 'workspace'),
        ),
      )
      .for('update');
    if (current === undefined) throw notFound('Deletion not found');
    if (current.status === 'cancelled') return { job: current, notice: null };
    if (current.status !== 'pending_cooloff' && current.status !== 'scheduled') {
      throw new DeletionError('DELETION_NOT_CANCELLABLE');
    }
    const [row] = await tx
      .update(deletionJob)
      .set({ status: 'cancelled', completedAt: ctx.now?.() ?? new Date() })
      .where(eq(deletionJob.id, jobId))
      .returning();
    if (row === undefined) throw notFound('Deletion not found');
    await record(auditCtx(ctx, tx), {
      action: 'workspace.deletion_cancelled',
      target: { kind: 'deletion_job', id: row.id },
      metadata: { jobId: row.id },
    });
    const [org] = await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, ctx.workspaceId));
    const notice: OwnerNotice = {
      workspaceId: ctx.workspaceId,
      slug: workspace.slug,
      name: org?.name ?? workspace.slug,
      owners: await ownersOf(tx, ctx.workspaceId),
      jobId: row.id,
      cooloffUntil: row.cooloffUntil,
    };
    return { job: row, notice };
  });
  if (result.notice !== null) await notifyOwners(ctx.db, 'cancelled', result.notice, deps);
  return toJob(result.job);
}

/** The current workspace's deletion in progress (pending, scheduled or running), or null. */
export async function getActiveWorkspaceDeletion(
  ctx: Pick<DeletionRequestCtx, 'db' | 'workspaceId' | 'userId'>,
): Promise<DeletionJob | null> {
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    // Every active member sees the banner; anyone else sees nothing.
    const [self] = await tx
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, ctx.workspaceId),
          eq(member.userId, ctx.userId),
          eq(member.status, 'active'),
        ),
      );
    if (self === undefined) return null;
    const [row] = await tx
      .select()
      .from(deletionJob)
      .where(activeWorkspaceDeletion(ctx.workspaceId))
      .limit(1);
    return row === undefined ? null : toJob(row);
  });
}
