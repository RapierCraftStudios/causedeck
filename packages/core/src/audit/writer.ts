// The audit writer (#227, #26 part 2). `record()` appends one `audit_event` row through the SQL
// chain function `app_audit_append()` (migration 0008_audit), which serialises each chain under an
// advisory lock and computes `hash = sha256(prev_hash || canonical_json(event))`. Workspace events
// run on a savepoint of the caller's transaction pinned to that workspace, so they commit or roll
// back with the action; account-level events (`workspaceId: null`) get a transaction of their own.
import { currentScope, TenancyError, withWorkspace, type Queryable } from '@causedeck/db';
import { createLogger, type Logger } from '@causedeck/observability';
import { is, sql } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

import {
  isAuditAction,
  isSecurityAction,
  type AuditContext,
  type AuditEventInput,
} from './events.ts';
import { assertRedacted, AuditRedactionError, hashUserAgent } from './redact.ts';

let log: Logger | undefined;
const logger = (): Logger => (log ??= createLogger({ service: 'audit' }));

/**
 * The error fields that are safe to log. Driver errors carry the failed query's parameters (the
 * metadata among them) in their message and `params`, so only names, codes and the database's
 * own message are kept.
 */
function loggableError(error: unknown): Record<string, unknown> {
  const e = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
  const cause = e.cause as { name?: unknown; code?: unknown; message?: unknown } | undefined;
  return cause && typeof cause === 'object'
    ? { name: e.name, causeName: cause.name, code: cause.code, message: cause.message }
    : { name: e.name, code: e.code };
}

/** True when `db` is a transaction already pinned to `workspaceId` (no new scope needed). */
function pinnedTo(db: Queryable, workspaceId: string): boolean {
  const scope = currentScope();
  return (
    is(db, PgTransaction) &&
    scope?.kind === 'workspace' &&
    scope.workspaceId?.toLowerCase() === workspaceId.toLowerCase()
  );
}

function append(db: Queryable, ctx: AuditContext, input: AuditEventInput, security: boolean) {
  const metadata = JSON.stringify(input.metadata ?? {});
  const ip = security ? (ctx.ip ?? null) : null;
  return db.execute(sql`
    select id from app_audit_append(
      ${ctx.workspaceId}::uuid, ${ctx.actor.userId}::uuid, ${ctx.actor.kind}::audit_actor_kind,
      ${input.action}, ${input.target?.kind ?? null}, ${input.target?.id ?? null},
      ${input.outcome ?? 'success'}::audit_outcome, ${ip}::inet,
      ${hashUserAgent(ctx.userAgent)}, ${ctx.requestId ?? null}, ${metadata}::jsonb)`);
}

/**
 * Record an audit event. Unknown actions, content-bearing metadata and tenancy violations always
 * throw. Otherwise a failed write throws for security actions (fail-closed: the caller's action
 * fails with it) and is logged and swallowed for informational ones (fail-open; the write ran on
 * its own savepoint, so the caller's transaction stays usable).
 */
export async function record(ctx: AuditContext, input: AuditEventInput): Promise<void> {
  if (!isAuditAction(input.action)) {
    throw new TypeError(`record: unknown audit action "${String(input.action)}"`);
  }
  assertRedacted(input.metadata);
  const security = isSecurityAction(input.action);
  try {
    if (ctx.workspaceId === null) {
      await ctx.db.transaction((tx) => append(tx, ctx, input, security));
    } else if (pinnedTo(ctx.db, ctx.workspaceId)) {
      // Already in the workspace's scope (the usual server action): one round trip for a security
      // event, whose failure aborts the caller anyway; a savepoint keeps fail-open safe.
      await (security
        ? append(ctx.db, ctx, input, security)
        : ctx.db.transaction((tx) => append(tx, ctx, input, security)));
    } else {
      const workspaceId = ctx.workspaceId;
      await withWorkspace(ctx.db, { workspaceId }, (tx) => append(tx, ctx, input, security));
    }
  } catch (error) {
    if (security || error instanceof TenancyError || error instanceof AuditRedactionError) {
      throw error;
    }
    // Action and error only: metadata values never reach the log.
    logger().error(
      { err: loggableError(error), action: input.action, workspaceId: ctx.workspaceId },
      'informational audit event not recorded',
    );
  }
}
