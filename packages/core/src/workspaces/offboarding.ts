// Member offboarding (#178, #18): reassign open work, revoke the member's sessions scoped to the
// workspace, mark the membership `removed` and record an audit event. Authorization (owner-only,
// last-owner guard) stays in `removeMember`, which calls this inside its transaction.
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { invalid, notFound } from './errors.ts';

type Queryable = Database | Transaction;

const { member, session } = schema;

/**
 * Open work a removed member holds (tasks, obligations). No such tables exist yet: their modules
 * register a provider so offboarding can require and perform a reassignment.
 */
export interface ReassignProvider {
  name: string;
  /** Open items `userId` holds in the workspace. */
  countOpen(tx: Queryable, workspaceId: string, userId: string): Promise<number>;
  reassign(tx: Queryable, workspaceId: string, fromUserId: string, toUserId: string): Promise<void>;
}

const reassignProviders = new Set<ReassignProvider>();

/** Register a provider; returns a function that unregisters it. */
export function registerReassignProvider(provider: ReassignProvider): () => void {
  reassignProviders.add(provider);
  return () => {
    reassignProviders.delete(provider);
  };
}

/** Unregister every provider (tests). */
export function clearReassignProviders(): void {
  reassignProviders.clear();
}

export interface AuditEvent {
  action: 'member.removed';
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  /** The user who took over open work, or `null` when there was none to reassign. */
  reassignedTo: string | null;
  at: Date;
}

/** Audit event stub; the real writer (audit log table) arrives in #26. */
export interface AuditSink {
  write(tx: Queryable, event: AuditEvent): Promise<void>;
}

export const noopAuditSink: AuditSink = {
  write: () => Promise.resolve(),
};

export const consoleAuditSink: AuditSink = {
  write: (_tx, event) => {
    console.info('audit event (console sink)', event);
    return Promise.resolve();
  },
};

let activeAuditSink: AuditSink = noopAuditSink;

/** The installed sink; delegates so callers can hold a stable reference. */
export const auditSink: AuditSink = {
  write: (tx, event) => activeAuditSink.write(tx, event),
};

/** Install an audit sink (#26, tests); `null` restores the no-op default. */
export function setAuditSink(sink: AuditSink | null): void {
  activeAuditSink = sink ?? noopAuditSink;
}

export interface OffboardMemberRequest {
  workspaceId: string;
  actorUserId: string;
  target: { memberId: string; userId: string };
  /** Member id that takes over open work; required when any provider reports open items. */
  reassignTo?: string | undefined;
}

/**
 * Open items (tasks, obligations) `userId` holds in the workspace, across every registered
 * provider. The members page asks before removal whether a reassignment is required.
 */
export async function countOpenWork(
  tx: Queryable,
  workspaceId: string,
  userId: string,
): Promise<number> {
  let open = 0;
  for (const provider of reassignProviders) {
    open += await provider.countOpen(tx, workspaceId, userId);
  }
  return open;
}

async function reassignTarget(
  tx: Queryable,
  request: OffboardMemberRequest,
): Promise<string | null> {
  if (request.reassignTo === undefined) return null;
  if (request.reassignTo === request.target.memberId) {
    throw invalid('Choose a different member to take over open tasks and obligations');
  }
  const [row] = await tx
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.id, request.reassignTo),
        eq(member.organizationId, request.workspaceId),
        eq(member.status, 'active'),
      ),
    );
  if (!row) throw notFound('Member to reassign to not found');
  return row.userId;
}

/**
 * Offboard an active member inside the caller's transaction. With open work and no `reassignTo`
 * this is a `VALIDATION` error and nothing changes. Only sessions whose active workspace is this
 * one are deleted; the member's other sessions survive and lose access here through `status`.
 */
export async function offboardMember(tx: Queryable, request: OffboardMemberRequest): Promise<void> {
  const { workspaceId, target } = request;
  const toUserId = await reassignTarget(tx, request);

  const open = await countOpenWork(tx, workspaceId, target.userId);
  if (open > 0 && toUserId === null) {
    throw invalid('Choose a member to take over open tasks and obligations');
  }
  if (toUserId !== null) {
    for (const provider of reassignProviders) {
      await provider.reassign(tx, workspaceId, target.userId, toUserId);
    }
  }

  await tx
    .delete(session)
    .where(and(eq(session.userId, target.userId), eq(session.activeOrganizationId, workspaceId)));
  await tx.update(member).set({ status: 'removed' }).where(eq(member.id, target.memberId));
  await auditSink.write(tx, {
    action: 'member.removed',
    workspaceId,
    actorUserId: request.actorUserId,
    targetUserId: target.userId,
    reassignedTo: toUserId,
    at: new Date(),
  });
}
