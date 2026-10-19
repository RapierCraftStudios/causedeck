// The AI budget service (#220, #30 part 3), called by the AI gateway around every model call:
//
//   const r = await reserve(ctx, { estimatePaise, purpose });
//   try {
//     const out = await call();
//     const { id } = await recordAiCall(db, workspaceId, aiCallInput(out)); // audit/ai-call.ts
//     await commit(ctx, r, actualPaise, { aiCallId: id });
//   } catch (e) { await release(ctx, r); throw e; }
//
// `reserve` holds `estimatePaise` of the workspace's monthly budget (`getAiBudget`, limits.ts) in
// `usage_reservation`, or throws `BUDGET_EXCEEDED` when `spent + reserved + estimate` exceeds the
// hard limit: the budget plus the courtesy grace (`ctx.thresholds`, thresholds.ts; default 0). The
// check is serialised per workspace by a transaction-scoped advisory lock, so concurrent reservations
// cannot oversubscribe the budget. `commit` swaps the reservation for the actual spend
// (`increment('ai.spend_paise')`, idempotent per reservation), with the `ai_call` id in the ledger
// metadata so `reconcileAiCalls` (reconcile.ts) can match the two; `release` drops it. Reservations
// expire after `RESERVATION_TTL_MS`: expired ones never count and are reaped by the next `reserve`
// (or `reapExpiredReservations`). After a recorded spend, `commit` runs the 80% soft-limit check
// (`checkAiBudgetThresholds`) when the context has `enqueueDelivery`; its failure never fails the
// commit. Only `reserve` consults the budget: nothing else is gated by it.
import { schema, withWorkspace } from '@causedeck/db';
import { and, eq, lte, sql, type SQL } from 'drizzle-orm';

import { getWorkspaceEntitlements } from '../billing/entitlements.ts';
import { AI_BUDGET_KEY } from './limits.ts';
import { increment, type IncrementResult, type UsageContext } from './meter.ts';
import { periodStart } from './period.ts';
import { checkAiBudgetThresholds, hardLimitPaise, resolveThresholds } from './thresholds.ts';

const { budgetOverride, usageCounter, usageReservation } = schema;

export const RESERVATION_TTL_MS = 5 * 60_000;

// Matches `USAGE_KEY_PATTERN_SOURCE` (packages/db/src/schema/usage.ts), as keys.ts does.
const PURPOSE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const PURPOSE_MAX_LENGTH = 64;

export interface Reservation {
  id: string;
  workspaceId: string;
  amountPaise: number;
  purpose: string;
  expiresAt: Date;
}

export interface ReserveInput {
  /** The call's estimated cost, integer paise. */
  estimatePaise: number;
  /** A dotted lowercase identifier, e.g. `capture.ocr` (no prose). */
  purpose: string;
}

export class BudgetError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
  readonly budgetPaise: number;
  readonly spentPaise: number;
  readonly reservedPaise: number;
  readonly estimatePaise: number;
  /** The limit `reserve` enforced: the budget plus the courtesy grace. */
  readonly limitPaise: number;

  constructor(v: {
    budgetPaise: number;
    spentPaise: number;
    reservedPaise: number;
    estimatePaise: number;
    limitPaise?: number;
  }) {
    const limitPaise = v.limitPaise ?? v.budgetPaise;
    super(
      `AI budget exceeded: ${String(v.spentPaise)} spent + ${String(v.reservedPaise)} reserved + ${String(v.estimatePaise)} estimated > ${String(limitPaise)} paise`,
    );
    this.name = 'BudgetError';
    this.budgetPaise = v.budgetPaise;
    this.spentPaise = v.spentPaise;
    this.reservedPaise = v.reservedPaise;
    this.estimatePaise = v.estimatePaise;
    this.limitPaise = limitPaise;
  }
}

const nowOf = (ctx: UsageContext): Date => ctx.now?.() ?? new Date();

const assertPaise = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`budget: ${name} must be a non-negative safe integer`);
  }
};

function assertOwn(ctx: UsageContext, reservation: Reservation): void {
  if (reservation.workspaceId.toLowerCase() !== ctx.workspaceId.toLowerCase()) {
    throw new TypeError('budget: the reservation belongs to another workspace');
  }
}

/** Serialises budget checks per workspace until the transaction ends. */
export function budgetLockSql(workspaceId: string): SQL {
  return sql`select pg_advisory_xact_lock(hashtextextended(${`usage_budget:${workspaceId}`}, 0))`;
}

/**
 * Reaps the workspace's expired reservations and reads, in one statement, the live reserved total,
 * the period's AI spend and the active staff override (null when none). The reap runs on the same
 * snapshot as the reads, so the reserved total filters on `expires_at` itself.
 */
export function budgetReadSql(workspaceId: string, now: Date): SQL {
  const at = sql`${now.toISOString()}::timestamptz`;
  return sql`
    with reaped as (
      delete from ${usageReservation}
      where workspace_id = ${workspaceId} and expires_at <= ${at}
    )
    select
      coalesce((select sum(r.amount_paise) from ${usageReservation} r
                where r.workspace_id = ${workspaceId} and r.expires_at > ${at}), 0) as reserved,
      coalesce((select c.value from ${usageCounter} c
                where c.workspace_id = ${workspaceId} and c.key = ${AI_BUDGET_KEY}
                  and c.period_start = ${periodStart(now).toISOString()}::timestamptz), 0) as spent,
      (select o.limit_value from ${budgetOverride} o
       where o.workspace_id = ${workspaceId} and o.key = ${AI_BUDGET_KEY} and o.expires_at > ${at}
       order by o.created_at desc, o.id desc limit 1) as override`;
}

/** Inserts a reservation and returns its id and expiry. */
export function reservationInsertSql(
  workspaceId: string,
  { estimatePaise, purpose }: ReserveInput,
  expiresAt: Date,
): SQL {
  return sql`
    insert into ${usageReservation} (workspace_id, amount_paise, purpose, expires_at)
    values (${workspaceId}, ${estimatePaise}, ${purpose}, ${expiresAt.toISOString()}::timestamptz)
    returning id`;
}

/** Hold `estimatePaise` of the workspace's AI budget, or throw `BUDGET_EXCEEDED`. */
export async function reserve(ctx: UsageContext, input: ReserveInput): Promise<Reservation> {
  const { estimatePaise, purpose } = input;
  assertPaise('estimatePaise', estimatePaise);
  if (
    typeof purpose !== 'string' ||
    purpose.length > PURPOSE_MAX_LENGTH ||
    !PURPOSE_PATTERN.test(purpose)
  ) {
    throw new TypeError('budget: purpose must be a dotted lowercase identifier');
  }
  const { courtesyGraceBps } = resolveThresholds(ctx);
  const now = nowOf(ctx);
  const { workspaceId } = ctx;
  return withWorkspace(ctx.db, { workspaceId }, async (tx) => {
    await tx.execute(budgetLockSql(workspaceId));
    const [row] = await tx.execute<{
      reserved: string | number;
      spent: string | number;
      override: string | number | null;
    }>(budgetReadSql(workspaceId, now));
    const reservedPaise = Number(row?.reserved ?? 0);
    const spentPaise = Number(row?.spent ?? 0);
    const budgetPaise =
      row?.override === null || row?.override === undefined
        ? (await getWorkspaceEntitlements(tx, workspaceId, now)).ai_budget_paise
        : Number(row.override);
    if (budgetPaise !== null) {
      const limitPaise = hardLimitPaise(budgetPaise, courtesyGraceBps);
      if (spentPaise + reservedPaise + estimatePaise > limitPaise) {
        throw new BudgetError({
          budgetPaise,
          spentPaise,
          reservedPaise,
          estimatePaise,
          limitPaise,
        });
      }
    }
    const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
    const [inserted] = await tx.execute<{ id: string }>(
      reservationInsertSql(workspaceId, input, expiresAt),
    );
    if (!inserted) throw new Error('budget: reservation insert returned no row');
    return { id: inserted.id, workspaceId, amountPaise: estimatePaise, purpose, expiresAt };
  });
}

/**
 * Replace the reservation with the call's actual spend. The spend is recorded even when the
 * reservation already expired; a repeated commit of the same reservation is not counted again.
 * With `ctx.enqueueDelivery`, a recorded spend then runs the soft-limit notice check. Pass the
 * call's `ai_call` id as `aiCallId` so the ledger row records it as `ai_call_id`.
 */
export async function commit(
  ctx: UsageContext,
  reservation: Reservation,
  actualPaise: number,
  { aiCallId }: { aiCallId?: string } = {},
): Promise<IncrementResult> {
  assertOwn(ctx, reservation);
  assertPaise('actualPaise', actualPaise);
  const { workspaceId, enqueueDelivery } = ctx;
  const result = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
    await tx
      .delete(usageReservation)
      .where(
        and(eq(usageReservation.workspaceId, workspaceId), eq(usageReservation.id, reservation.id)),
      );
    return increment({ ...ctx, db: tx }, AI_BUDGET_KEY, actualPaise, {
      idempotencyKey: `reservation:${reservation.id}`,
      metadata:
        aiCallId === undefined
          ? { reservation_id: reservation.id }
          : { reservation_id: reservation.id, ai_call_id: aiCallId },
    });
  });
  if (enqueueDelivery !== undefined && result.applied) {
    // After the spend committed; a failed notice never fails or changes the commit.
    await checkAiBudgetThresholds({ ...ctx, enqueueDelivery }).catch(() => undefined);
  }
  return result;
}

/** Drop the reservation without spending; idempotent. */
export async function release(ctx: UsageContext, reservation: Reservation): Promise<void> {
  assertOwn(ctx, reservation);
  const { workspaceId } = ctx;
  await withWorkspace(ctx.db, { workspaceId }, (tx) =>
    tx
      .delete(usageReservation)
      .where(
        and(eq(usageReservation.workspaceId, workspaceId), eq(usageReservation.id, reservation.id)),
      ),
  );
}

/** Delete the workspace's expired reservations; returns how many were reaped. */
export async function reapExpiredReservations(ctx: UsageContext): Promise<number> {
  const now = nowOf(ctx);
  const { workspaceId } = ctx;
  const rows = await withWorkspace(ctx.db, { workspaceId }, (tx) =>
    tx
      .delete(usageReservation)
      .where(
        and(eq(usageReservation.workspaceId, workspaceId), lte(usageReservation.expiresAt, now)),
      )
      .returning({ id: usageReservation.id }),
  );
  return rows.length;
}
