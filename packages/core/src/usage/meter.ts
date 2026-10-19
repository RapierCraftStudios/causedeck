// The usage meter (#219, #30 part 2). `increment` appends to the `usage_event` ledger and adds to
// the period's `usage_counter` in one `withWorkspace` transaction, as one statement (one round
// trip): the ledger insert claims the idempotency key (unique per workspace), and only a fresh
// claim reaches the counter, whose upsert (`ON CONFLICT DO UPDATE SET value = value +
// excluded.value`) is atomic under concurrency. Only
// keys, numbers and ids are written, never customer content.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { isUsageKey, USAGE_KEY_KINDS, type UsageKey } from './keys.ts';
import { periodStart, usagePeriod, type UsagePeriod } from './period.ts';

const { usageCounter, usageEvent } = schema;

const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/** `usage_event.metadata`: ids only, keyed like `ai_call_id`. */
export type UsageEventMetadata = NonNullable<(typeof usageEvent.$inferInsert)['metadata']>;

export interface UsageContext {
  db: Database | Transaction;
  workspaceId: string;
  /** Clock override (tests, jobs replaying a past event). */
  now?: () => Date;
}

export interface IncrementOptions {
  /** Unique per workspace; a repeated key is not counted again. */
  idempotencyKey: string;
  /** Ids only, keyed like `ai_call_id`. */
  metadata?: UsageEventMetadata | undefined;
  /** When the usage happened; picks the period. Defaults to `ctx.now()`. */
  at?: Date;
}

export interface IncrementResult {
  /** False when the idempotency key was already recorded (nothing written). */
  applied: boolean;
  /** The period's counter after the increment, or null when not applied. */
  value: number | null;
}

function validate(key: string, amount: number, idempotencyKey: string): asserts key is UsageKey {
  if (!isUsageKey(key)) throw new TypeError(`usage: unknown key ${JSON.stringify(key)}`);
  if (!Number.isSafeInteger(amount)) throw new TypeError('usage: amount must be a safe integer');
  if (USAGE_KEY_KINDS[key] === 'counter' && amount < 0) {
    throw new TypeError(`usage: ${key} only takes amounts >= 0`);
  }
  if (
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.length === 0 ||
    idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    throw new TypeError(
      `usage: idempotencyKey must be 1 to ${String(IDEMPOTENCY_KEY_MAX_LENGTH)} characters`,
    );
  }
}

const nowOf = (ctx: UsageContext): Date => ctx.now?.() ?? new Date();

/** Record `amount` of `key` for the context workspace, at most once per `idempotencyKey`. */
export async function increment(
  ctx: UsageContext,
  key: UsageKey,
  amount: number,
  { idempotencyKey, metadata, at }: IncrementOptions,
): Promise<IncrementResult> {
  validate(key, amount, idempotencyKey);
  const when = at ?? nowOf(ctx);
  const { workspaceId } = ctx;
  return withWorkspace(ctx.db, { workspaceId }, async (tx) => {
    const [row] = await tx.execute<{ value: string | number }>(
      incrementSql({ workspaceId, key, amount, idempotencyKey, metadata, at: when }),
    );
    return row === undefined
      ? { applied: false, value: null }
      : { applied: true, value: Number(row.value) };
  });
}

/**
 * The single statement behind `increment` (exported for the overhead test, which runs it under
 * `EXPLAIN ANALYZE`): the ledger insert claims the idempotency key, and the counter upsert reads
 * only the claimed row, so a replay (nothing claimed) touches no counter and returns no row.
 * Inputs must already be validated; run it only inside the workspace's `withWorkspace` scope.
 */
export function incrementSql({
  workspaceId,
  key,
  amount,
  idempotencyKey,
  metadata,
  at,
}: {
  workspaceId: string;
  key: UsageKey;
  amount: number;
  idempotencyKey: string;
  metadata?: UsageEventMetadata | undefined;
  at: Date;
}): SQL {
  return sql`
    with claimed as (
      insert into ${usageEvent} (workspace_id, key, amount, idempotency_key, metadata, created_at)
      values (${workspaceId}, ${key}, ${amount}, ${idempotencyKey},
              ${JSON.stringify(metadata ?? {})}::jsonb, ${at.toISOString()}::timestamptz)
      on conflict (workspace_id, idempotency_key) do nothing
      returning workspace_id, key, amount
    )
    insert into ${usageCounter} as c (workspace_id, key, period_start, value)
    select workspace_id, key, ${periodStart(at).toISOString()}::timestamptz, amount from claimed
    on conflict (workspace_id, key, period_start) do update set value = c.value + excluded.value
    returning c.value`;
}

/** The context workspace's total of `key` in `period` (default: the current IST month), else 0. */
export async function getUsage(
  ctx: UsageContext,
  key: UsageKey,
  period: UsagePeriod = usagePeriod(nowOf(ctx)),
): Promise<number> {
  if (!isUsageKey(key)) throw new TypeError(`usage: unknown key ${JSON.stringify(key)}`);
  const { workspaceId } = ctx;
  const [row] = await withWorkspace(ctx.db, { workspaceId }, (tx) =>
    tx
      .select({ value: usageCounter.value })
      .from(usageCounter)
      .where(
        and(
          eq(usageCounter.workspaceId, workspaceId),
          eq(usageCounter.key, key),
          eq(usageCounter.periodStart, period.start),
        ),
      ),
  );
  return row?.value ?? 0;
}
