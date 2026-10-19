// `system.billing.dunning-tick` (#28 part 6, #205): the daily driver of the dunning policy in
// `@causedeck/billing/dunning`. For every `past_due` subscription (grace included) it asks
// `planDunning` what is due, retries the payment through the provider (day 1, 3, 5, 7), applies
// `halted` (day 8, still unpaid: grace) or `grace_expired` (downgraded: read-only Junior) through
// the state machine, and sends each stage's `billing.notice` (#23) to the workspace owners, the
// only role with `billing.manage`. A charge still arrives only by webhook (`billing.process-event`),
// which ends the episode. Nothing is deleted.
//
// `subscription` is under FORCE row-level security and this job has no workspace, so it lists its
// targets (ids only) through the owner-defined `app_billing_dunning_targets` function
// (0015_billing_dunning) and works on each row inside its own `withWorkspace` scope. Notices go out
// after that transaction commits; their dedupe keys make a rerun send nothing twice. One failing
// workspace never stops the others.
import {
  dunningDedupeKey,
  dunningNoticeCopy,
  fromSubscriptionRow,
  getPlan,
  planDunning,
  toSubscriptionStatus,
  transition,
  type DunningStage,
} from '@causedeck/billing';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@causedeck/billing/plans';
import { createBillingProvider, type BillingProvider } from '@causedeck/billing/provider';
import { serverEnv } from '@causedeck/config/env';
import { schema, withWorkspace } from '@causedeck/db';
import { notify, type DeliveryJob } from '@causedeck/notifications';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { invalidateEntitlements } from '../../billing/entitlements.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { getProducer } from '../producer.ts';
import { deliveryKey, notificationDeliverSchema } from './notification-deliver.ts';

const { member, organization, subscription } = schema;

export interface DunningTickReport {
  checked: number;
  retried: number;
  halted: number;
  downgraded: number;
  notified: number;
}

export interface DunningTickDeps {
  now?: () => Date;
  /** `NotifyContext.enqueueDelivery`; defaults to sending `notification.deliver`. */
  enqueueDelivery?: (job: DeliveryJob) => Promise<unknown>;
}

/**
 * Send one `notification.deliver` job as the registry's `enqueue` does (schema, singleton key,
 * workspace fairness group). The registry imports this file, so it cannot be imported here.
 */
async function enqueueDelivery(job: DeliveryJob): Promise<unknown> {
  const data = notificationDeliverSchema.parse(job);
  const sender = await getProducer();
  return sender.send('notification.deliver', data, {
    singletonKey: deliveryKey(data),
    group: { id: data.workspaceId },
  });
}

const isStatus = (status: string): status is SubscriptionStatus =>
  (SUBSCRIPTION_STATUSES as readonly string[]).includes(status);

interface Pending {
  subscriptionId: string;
  dunningStartedAt: Date;
  planName: string;
  slug: string;
  owners: string[];
  notices: DunningStage[];
}

/** Run one dunning pass. Exported for tests; logs carry ids only. */
export async function runBillingDunningTick(
  ctx: Pick<JobContext, 'db' | 'log'>,
  provider: Pick<BillingProvider, 'retryPayment'>,
  deps: DunningTickDeps = {},
): Promise<DunningTickReport> {
  const now = deps.now ?? (() => new Date());
  const send = deps.enqueueDelivery ?? enqueueDelivery;
  const report: DunningTickReport = {
    checked: 0,
    retried: 0,
    halted: 0,
    downgraded: 0,
    notified: 0,
  };

  const targets = await ctx.db.execute<{ workspace_id: string; subscription_id: string }>(
    sql`select workspace_id::text, subscription_id::text from app_billing_dunning_targets()`,
  );

  for (const target of targets) {
    const workspaceId = target.workspace_id;
    const fields = { workspaceId, subscriptionId: target.subscription_id };
    report.checked += 1;
    let pending: Pending | null;
    try {
      pending = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
        const [row] = await tx
          .select()
          .from(subscription)
          .where(eq(subscription.id, target.subscription_id))
          .for('update');
        if (!row || !isStatus(row.status) || row.dunningStartedAt === null) return null;

        const at = now();
        const before = fromSubscriptionRow({ ...row, status: row.status });
        const plan = planDunning({
          snapshot: before,
          dunningStartedAt: row.dunningStartedAt,
          attempts: row.dunningAttempts,
          now: at,
        });

        if (plan.retry && plan.attempt !== null) {
          if (row.providerSubscriptionId === null) return null;
          const result = await provider.retryPayment(row.providerSubscriptionId);
          await tx
            .update(subscription)
            .set({ dunningAttempts: plan.attempt })
            .where(eq(subscription.id, row.id));
          report.retried += 1;
          ctx.log.info(
            { ...fields, attempt: plan.attempt, outcome: result.outcome },
            'billing dunning retry',
          );
        }

        if (plan.event !== null) {
          const next = transition(before, plan.event, at);
          await tx
            .update(subscription)
            .set({
              status: toSubscriptionStatus(next.state),
              graceUntil: next.graceUntil,
              cancelAtPeriodEnd: next.cancelAtPeriodEnd,
            })
            .where(eq(subscription.id, row.id));
          if (plan.event.type === 'halted') report.halted += 1;
          else report.downgraded += 1;
          ctx.log.info(
            { ...fields, event: plan.event.type, to: next.state },
            'billing dunning event',
          );
        }

        if (plan.notices.length === 0) return null;
        const [org] = await tx
          .select({ slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, workspaceId));
        const owners = await tx
          .select({ userId: member.userId })
          .from(member)
          .where(
            and(
              eq(member.organizationId, workspaceId),
              eq(member.role, 'owner'),
              eq(member.status, 'active'),
            ),
          );
        return {
          subscriptionId: row.id,
          dunningStartedAt: row.dunningStartedAt,
          planName: getPlan(row.planId)?.name ?? row.planId,
          slug: org?.slug ?? '',
          owners: owners.map((o) => o.userId),
          notices: plan.notices,
        };
      });
    } catch (error) {
      ctx.log.warn(
        { ...fields, error: error instanceof Error ? error.name : 'NonError' },
        'billing dunning failed for subscription',
      );
      continue;
    }
    if (pending === null) continue;
    invalidateEntitlements(workspaceId);

    const notifyCtx = { db: ctx.db, workspaceId, enqueueDelivery: send };
    for (const stage of pending.notices) {
      const copy = dunningNoticeCopy(stage, { planName: pending.planName });
      for (const userId of pending.owners) {
        try {
          await notify(notifyCtx, {
            userId,
            category: 'billing.notice',
            title: copy.title,
            body: copy.body,
            href: `/w/${pending.slug}/settings/billing`,
            dedupeKey: dunningDedupeKey(pending.subscriptionId, pending.dunningStartedAt, stage),
          });
          report.notified += 1;
        } catch (error) {
          ctx.log.warn(
            { ...fields, stage, error: error instanceof Error ? error.name : 'NonError' },
            'billing dunning notice failed',
          );
        }
      }
    }
  }

  ctx.log.info({ ...report }, 'billing dunning complete');
  return report;
}

export const billingDunningTick = defineJob({
  name: 'system.billing.dunning-tick',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'billing-dunning-tick', policy: 'stately' },
  // 04:30 IST, after the 04:00 reconcile.
  schedule: { cron: '30 4 * * *', payload: {} },
  handler: async (ctx) => {
    await runBillingDunningTick(ctx, createBillingProvider(serverEnv()));
  },
});
