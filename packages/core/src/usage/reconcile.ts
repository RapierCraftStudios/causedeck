// AI call reconciliation (#225, #30 part 8). Every model call writes an `ai_call` row (#227) and,
// through `commit(ctx, r, actualPaise, { aiCallId })`, an `ai.spend_paise` ledger row whose
// metadata carries `ai_call_id`. `reconcileAiCalls` joins the two for one period and reports each
// id where they disagree: a call with no ledger row (`missing_usage`), a ledger row naming no call
// (`orphan_usage`), or a cost that differs from the ledger total (`amount_mismatch`). Both sides
// are filtered by their own `created_at`, so a call and its spend that land on opposite sides of a
// month boundary are reported in each period rather than hidden. Ledger rows without `ai_call_id`
// (other keys, commits without an id) are not part of the reconciliation. Read-only; ids and
// numbers only, never call content.
import { schema, withWorkspace } from '@causedeck/db';
import { sql, type SQL } from 'drizzle-orm';

import { AI_BUDGET_KEY } from './limits.ts';
import type { UsageContext } from './meter.ts';
import { usagePeriod, type UsagePeriod } from './period.ts';

const { aiCall, usageEvent } = schema;

export type AiCallMismatchKind = 'missing_usage' | 'orphan_usage' | 'amount_mismatch';

export interface AiCallMismatch {
  aiCallId: string;
  kind: AiCallMismatchKind;
  /** `ai_call.cost_paise`, or null when no call has this id in the period. */
  costPaise: number | null;
  /** Sum of the period's `ai.spend_paise` ledger rows for this id, or null when there are none. */
  usagePaise: number | null;
}

export interface AiCallReconciliation {
  period: UsagePeriod;
  /** Distinct ids seen on either side. */
  checked: number;
  /** Ids whose cost equals the ledger total. */
  matched: number;
  /** Ordered by `aiCallId`. */
  mismatches: AiCallMismatch[];
}

/**
 * The statement behind `reconcileAiCalls`: one row per id seen in the period's `ai_call` rows or
 * its `ai_call_id` ledger rows, with the call's cost and the ledger total (null on the missing
 * side). Ids compare as lowercase text, so a malformed metadata id cannot raise a uuid cast error.
 * Run it only inside the workspace's `withWorkspace` scope.
 */
export function reconcileAiCallsSql(workspaceId: string, period: UsagePeriod): SQL {
  const start = sql`${period.start.toISOString()}::timestamptz`;
  const end = sql`${period.end.toISOString()}::timestamptz`;
  return sql`
    with calls as (
      select lower(c.id::text) as ai_call_id, c.cost_paise as cost
      from ${aiCall} c
      where c.workspace_id = ${workspaceId} and c.created_at >= ${start} and c.created_at < ${end}
    ),
    spend as (
      select lower(e.metadata ->> 'ai_call_id') as ai_call_id, sum(e.amount) as amount
      from ${usageEvent} e
      where e.workspace_id = ${workspaceId} and e.key = ${AI_BUDGET_KEY}
        and e.metadata ->> 'ai_call_id' is not null
        and e.created_at >= ${start} and e.created_at < ${end}
      group by 1
    )
    select coalesce(calls.ai_call_id, spend.ai_call_id) as ai_call_id,
           calls.cost as cost_paise, spend.amount as usage_paise
    from calls full outer join spend on spend.ai_call_id = calls.ai_call_id
    order by 1`;
}

const toNumber = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

/** Reconcile the context workspace's AI calls with its AI spend ledger for `period`. */
export async function reconcileAiCalls(
  ctx: UsageContext,
  period: UsagePeriod = usagePeriod(ctx.now?.() ?? new Date()),
): Promise<AiCallReconciliation> {
  const { workspaceId } = ctx;
  const rows = await withWorkspace(ctx.db, { workspaceId }, (tx) =>
    tx.execute<{
      ai_call_id: string;
      cost_paise: string | number | null;
      usage_paise: string | number | null;
    }>(reconcileAiCallsSql(workspaceId, period)),
  );
  const mismatches: AiCallMismatch[] = [];
  let matched = 0;
  for (const row of rows) {
    const costPaise = toNumber(row.cost_paise);
    const usagePaise = toNumber(row.usage_paise);
    const kind: AiCallMismatchKind | null =
      usagePaise === null
        ? 'missing_usage'
        : costPaise === null
          ? 'orphan_usage'
          : costPaise === usagePaise
            ? null
            : 'amount_mismatch';
    if (kind === null) matched += 1;
    else mismatches.push({ aiCallId: row.ai_call_id, kind, costPaise, usagePaise });
  }
  return { period, checked: rows.length, matched, mismatches };
}
