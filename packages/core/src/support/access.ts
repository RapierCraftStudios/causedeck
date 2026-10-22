// The read-only support context (#308, part of #27; spike §6). During a granted `view` session,
// staff reach workspace content only through `ctx.supportSession` from `withSupportSession`:
//   * `read(action, targets, fn)` re-checks the session (revocation and expiry take effect at
//     once), checks `can()` for a staff actor, runs `fn` on a savepoint that is always rolled back
//     (nothing `fn` writes can persist), and audits `support.view` with the target ids. The audit
//     event is fail-closed: a read that cannot be audited is not returned.
//   * `assertCan(action, resource?)` is the gate for anything else staff code wants to do: `can()`
//     denies every write for `kind: 'staff'` (`STAFF_READ_ONLY`), and every denial is audited as
//     `access.denied` (actor kind `staff`, outcome `denied`) before `ForbiddenError` is thrown.
// A `metadata` session never reaches content.
import {
  can,
  ForbiddenError,
  type Action,
  type Actor,
  type Resource,
} from '@causedeck/auth/policy';
import { withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { TransactionRollbackError } from 'drizzle-orm';

import { recordAccessDenied, recordSupportView } from '../audit/index.ts';
import { forbidden } from '../workspaces/index.ts';
import { assertActiveSupportSession, type StaffContext, type SupportSession } from './sessions.ts';

/** What a staff member reads; ids only, never content. */
export interface SupportTarget {
  kind: string;
  id: string;
}

/** Actions a support read may be checked against: every `.read` action. */
export type SupportReadAction = Extract<Action, `${string}.read`>;

export interface SupportContext {
  /** The session as it was when the context opened; `read` re-checks it each time. */
  readonly supportSession: SupportSession;
  /** The staff actor `can()` decides for: read-only, advocate-level reads, never restricted matters. */
  readonly actor: Actor;
  read<T>(
    action: SupportReadAction,
    targets: readonly SupportTarget[],
    fn: (tx: Transaction) => Promise<T>,
    resource?: Resource,
  ): Promise<T>;
  assertCan(action: Action, resource?: Resource): Promise<void>;
}

/**
 * The role a staff actor reads with: an advocate's reads (matters, documents, tasks, audit), so
 * restricted matters stay hidden and owner-only billing stays out of reach.
 */
export const SUPPORT_ACTOR_ROLE = 'advocate' as const;

class SupportReadAborted extends Error {}

/** Run `fn` on a savepoint that is always rolled back, returning what it read. */
async function readOnly<T>(tx: Transaction, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let result: { value: T } | undefined;
  try {
    await tx.transaction(async (sp) => {
      result = { value: await fn(sp) };
      throw new SupportReadAborted();
    });
  } catch (error) {
    if (!(error instanceof SupportReadAborted || error instanceof TransactionRollbackError)) {
      throw error;
    }
  }
  if (result === undefined) throw new Error('support read ended without a result');
  return result.value;
}

function openContext(ctx: StaffContext, session: SupportSession): SupportContext {
  const workspaceId = session.workspaceId;
  const actor: Actor = Object.freeze({
    userId: ctx.staffUserId,
    workspaceId,
    role: SUPPORT_ACTOR_ROLE,
    kind: 'staff',
  });
  const meta = {
    ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
    ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
    ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
  };

  /** Audit the denial (fail-open, on its own transaction when `db` is the root client), then throw. */
  async function deny(action: Action, reason: string, error: Error): Promise<never> {
    // The root client in production, so the denial survives the caller's rollback; tests pass a
    // transaction, where it lands on a savepoint.
    await recordAccessDenied(ctx.db as Database, {
      workspaceId,
      member: true,
      actorUserId: ctx.staffUserId,
      actorKind: 'staff',
      action,
      reason,
      supportSessionId: session.id,
      ...meta,
    });
    throw error;
  }

  async function assertCan(action: Action, resource?: Resource): Promise<void> {
    const decision = can(actor, action, resource);
    if (!decision.allow) {
      await deny(action, decision.reason, new ForbiddenError(action, decision.reason));
    }
  }

  async function read<T>(
    action: SupportReadAction,
    targets: readonly SupportTarget[],
    fn: (tx: Transaction) => Promise<T>,
    resource?: Resource,
  ): Promise<T> {
    if (targets.length === 0) throw new TypeError('support read: name at least one target');
    // Revoked, expired or ended since the context opened: no more reads.
    const current = await assertActiveSupportSession(ctx.staffUserId, workspaceId, {
      db: ctx.db,
    });
    if (current.id !== session.id) throw forbidden('The support session changed');
    if (current.scope !== 'view') {
      await deny(
        action,
        'SUPPORT_SCOPE_METADATA',
        forbidden('This support session does not include content access'),
      );
    }
    await assertCan(action, resource);
    return withWorkspace(ctx.db, { workspaceId, userId: ctx.staffUserId }, async (tx) => {
      const value = await readOnly(tx, fn);
      await recordSupportView(
        { db: tx, ...meta },
        {
          supportSessionId: session.id,
          staffUserId: ctx.staffUserId,
          workspaceId,
          targets,
          action,
        },
      );
      return value;
    });
  }

  return Object.freeze({ supportSession: session, actor, read, assertCan });
}

/**
 * `ctx` plus `supportSession`, the read-only support context for `workspaceId`. Throws
 * `SupportSessionInactiveError` without a granted, unexpired session.
 */
export async function withSupportSession<C extends StaffContext>(
  ctx: C,
  workspaceId: string,
): Promise<C & { supportSession: SupportContext }> {
  const session = await assertActiveSupportSession(ctx.staffUserId, workspaceId, { db: ctx.db });
  return { ...ctx, supportSession: openContext(ctx, session) };
}
