// Usage thresholds (#221, #30 part 4) for the monthly AI budget (`ai.spend_paise`):
//
// - Soft limit, 80% (`SOFT_LIMIT_BPS`): `checkAiBudgetThresholds` sends the `usage.warning` notice
//   (events.ts) to the workspace's active owners, in-app and email, at most once per IST period.
//   `commit` (budget.ts) runs it after each recorded spend when the context has `enqueueDelivery`.
// - Hard limit, 100% (`HARD_LIMIT_BPS`) plus a configurable courtesy grace
//   (`UsageContext.thresholds.courtesyGraceBps`, default 0): `reserve` throws `BUDGET_EXCEEDED`.
//
// The hard-limit guarantee: only `reserve`, i.e. a new AI call, consults the budget. Existing data,
// reads, manual entry, export (#31) and non-AI metering (`increment`, `getUsage`) are never gated,
// entitlements (`features.write`) do not depend on AI spend, and nothing is deleted or hidden.
import { schema, withWorkspace } from '@causedeck/db';
import { notify, type DeliveryJob } from '@causedeck/notifications';
import { and, eq } from 'drizzle-orm';

import { usageWarningCopy, usageWarningDedupeKey } from './events.ts';
import { AI_BUDGET_KEY, getAiBudget } from './limits.ts';
import { getUsage, type UsageContext } from './meter.ts';
import { usagePeriod } from './period.ts';

const { member, organization } = schema;

/** Basis points of the budget. */
export const SOFT_LIMIT_BPS = 8_000;
export const HARD_LIMIT_BPS = 10_000;

export interface UsageThresholds {
  /** Spend allowed beyond the budget before `reserve` blocks, in basis points of the budget. */
  courtesyGraceBps: number;
}

export const DEFAULT_USAGE_THRESHOLDS: Readonly<UsageThresholds> = Object.freeze({
  courtesyGraceBps: 0,
});

export type UsageLevel = 'ok' | 'warning' | 'exceeded';

/** The context's thresholds over the defaults. */
export function resolveThresholds(ctx: Pick<UsageContext, 'thresholds'>): UsageThresholds {
  const courtesyGraceBps =
    ctx.thresholds?.courtesyGraceBps ?? DEFAULT_USAGE_THRESHOLDS.courtesyGraceBps;
  if (!Number.isSafeInteger(courtesyGraceBps) || courtesyGraceBps < 0) {
    throw new TypeError('usage: courtesyGraceBps must be a non-negative safe integer');
  }
  return { courtesyGraceBps };
}

/** The spend `reserve` allows: the budget plus the courtesy grace (rounded down). */
export function hardLimitPaise(budgetPaise: number, graceBps: number): number {
  return budgetPaise + Math.floor((budgetPaise * graceBps) / HARD_LIMIT_BPS);
}

/** Where `spentPaise` stands against the budget; `null` (unlimited) is always `ok`. */
export function usageLevel(spentPaise: number, budgetPaise: number | null): UsageLevel {
  if (budgetPaise === null) return 'ok';
  if (spentPaise >= budgetPaise) return 'exceeded';
  if (spentPaise * HARD_LIMIT_BPS >= budgetPaise * SOFT_LIMIT_BPS) return 'warning';
  return 'ok';
}

export interface ThresholdCheck {
  level: UsageLevel;
  spentPaise: number;
  budgetPaise: number | null;
  /** Owners `notify` was called for without error (a deduped repeat still counts). */
  notified: number;
}

/**
 * Notify the active owners once per period when this period's AI spend is at or above the soft
 * limit. One owner's failure never stops the others.
 */
export async function checkAiBudgetThresholds(
  ctx: UsageContext & { enqueueDelivery: (job: DeliveryJob) => Promise<unknown> },
): Promise<ThresholdCheck> {
  const now = ctx.now?.() ?? new Date();
  const at = { ...ctx, now: () => now };
  const spentPaise = await getUsage(at, AI_BUDGET_KEY);
  const { budgetPaise } = await getAiBudget(at);
  const level = usageLevel(spentPaise, budgetPaise);
  const result: ThresholdCheck = { level, spentPaise, budgetPaise, notified: 0 };
  if (level === 'ok') return result;

  const { workspaceId } = ctx;
  const { slug, owners } = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
    const [org] = await tx
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, workspaceId));
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
    return { slug: org?.slug ?? '', owners: rows.map((r) => r.userId) };
  });

  const copy = usageWarningCopy({ level });
  const dedupeKey = usageWarningDedupeKey(AI_BUDGET_KEY, usagePeriod(now));
  const notifyCtx = { db: ctx.db, workspaceId, enqueueDelivery: ctx.enqueueDelivery };
  for (const userId of owners) {
    try {
      await notify(notifyCtx, {
        userId,
        category: 'billing.notice',
        title: copy.title,
        body: copy.body,
        href: `/w/${slug}/settings/billing`,
        dedupeKey,
      });
      result.notified += 1;
    } catch {
      // One owner's failed notice (e.g. a delivery enqueue error) must not stop the others.
    }
  }
  return result;
}
