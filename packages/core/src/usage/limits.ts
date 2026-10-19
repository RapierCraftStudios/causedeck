// Effective AI budgets and staff overrides (#220, #30 part 3). A workspace's monthly AI budget is the
// newest unexpired staff `budget_override` for `ai.spend_paise`, else its `ai_budget_paise`
// entitlement (#203: Junior Rs 10, paid plans Rs 175 per seat pooled). Overrides are staff-only,
// always justified and always expiring, and every one is audited (`usage.budget_override_set`, a
// security action: an override whose audit write fails is rolled back with it).
import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import { and, desc, eq, gt } from 'drizzle-orm';

import { record } from '../audit/writer.ts';
import { getWorkspaceEntitlements } from '../billing/entitlements.ts';
import type { UsageKey } from './keys.ts';
import type { UsageContext } from './meter.ts';

const { budgetOverride } = schema;

/** The metered key an AI budget caps, and the `budget_override.key` that overrides it. */
export const AI_BUDGET_KEY = 'ai.spend_paise' satisfies UsageKey;

export interface AiBudget {
  /** Monthly budget in paise; `null` means unlimited. */
  budgetPaise: number | null;
  source: 'override' | 'entitlement';
}

const nowOf = (ctx: UsageContext): Date => ctx.now?.() ?? new Date();

/** The active override's limit, or undefined. Run inside the workspace's scope. */
export async function activeOverride(
  tx: Transaction,
  workspaceId: string,
  now: Date,
): Promise<number | undefined> {
  const [row] = await tx
    .select({ limitValue: budgetOverride.limitValue })
    .from(budgetOverride)
    .where(
      and(
        eq(budgetOverride.workspaceId, workspaceId),
        eq(budgetOverride.key, AI_BUDGET_KEY),
        gt(budgetOverride.expiresAt, now),
      ),
    )
    .orderBy(desc(budgetOverride.createdAt), desc(budgetOverride.id))
    .limit(1);
  return row?.limitValue;
}

/** The context workspace's effective monthly AI budget. */
export async function getAiBudget(ctx: UsageContext): Promise<AiBudget> {
  const now = nowOf(ctx);
  const { workspaceId } = ctx;
  return withWorkspace(ctx.db, { workspaceId }, async (tx) => {
    const override = await activeOverride(tx, workspaceId, now);
    if (override !== undefined) return { budgetPaise: override, source: 'override' };
    const entitlements = await getWorkspaceEntitlements(tx, workspaceId, now);
    return { budgetPaise: entitlements.ai_budget_paise, source: 'entitlement' };
  });
}

export interface BudgetOverrideInput {
  /** The new monthly AI budget, integer paise. */
  limitPaise: number;
  /** Why staff set it; stored on the override, never in the audit metadata. */
  reason: string;
  /** Must be in the future. */
  expiresAt: Date;
  /** The staff user setting the override (`budget_override.set_by`, the audit actor). */
  staffUserId: string;
  requestId?: string;
}

/** Set a staff override of the workspace's AI budget and audit it, in one transaction. */
export async function setBudgetOverride(
  ctx: UsageContext,
  input: BudgetOverrideInput,
): Promise<{ id: string }> {
  const { limitPaise, reason, expiresAt, staffUserId, requestId } = input;
  if (!Number.isSafeInteger(limitPaise) || limitPaise < 0) {
    throw new TypeError('setBudgetOverride: limitPaise must be a non-negative safe integer');
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new TypeError('setBudgetOverride: a reason is required');
  }
  if (!(expiresAt instanceof Date) || !(expiresAt.getTime() > nowOf(ctx).getTime())) {
    throw new TypeError('setBudgetOverride: expiresAt must be in the future');
  }
  const { workspaceId } = ctx;
  return withWorkspace(ctx.db, { workspaceId }, async (tx) => {
    const [row] = await tx
      .insert(budgetOverride)
      .values({
        workspaceId,
        key: AI_BUDGET_KEY,
        limitValue: limitPaise,
        setBy: staffUserId,
        reason: reason.trim(),
        expiresAt,
      })
      .returning({ id: budgetOverride.id });
    if (!row) throw new Error('setBudgetOverride: insert returned no row');
    await record(
      {
        db: tx,
        workspaceId,
        actor: { userId: staffUserId, kind: 'staff' },
        ...(requestId === undefined ? {} : { requestId }),
      },
      {
        action: 'usage.budget_override_set',
        target: { kind: 'budget_override', id: row.id },
        metadata: {
          key: AI_BUDGET_KEY,
          limit_paise: limitPaise,
          expires_at: expiresAt.toISOString(),
        },
      },
    );
    return { id: row.id };
  });
}
