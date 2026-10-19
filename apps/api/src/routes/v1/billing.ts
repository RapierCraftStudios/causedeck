// `GET /v1/billing/plans` and `GET /v1/billing/subscription` (#204). Plans are the active
// catalogue (not workspace data). The subscription is the workspace's current one (the live row,
// else the most recent ended one), read under the workspace scope; provider ids, GSTIN and the
// billing email are never returned.
import { PLAN_CATALOGUE } from '@causedeck/billing/plans';
import { loadSubscription } from '@causedeck/core/billing';
import type { Database } from '@causedeck/db';
import {
  BillingPlansResponseSchema,
  BillingSubscriptionResponseSchema,
  type BillingSubscription,
} from '@causedeck/validators/api';

import { createRouter, defineRoute, problemResponses, type AppRouter } from '../../lib/openapi.ts';
import { requireWorkspace } from '../../middleware/workspace.ts';

export const listBillingPlansRoute = defineRoute({
  method: 'get',
  path: '/billing/plans',
  operationId: 'listBillingPlans',
  tags: ['Billing'],
  summary: 'The active plan catalogue (prices in paise, ex-GST)',
  responses: {
    200: {
      description: 'Active plans',
      content: { 'application/json': { schema: BillingPlansResponseSchema } },
    },
    ...problemResponses(401, 429),
  },
});

export function billingSubscriptionRoute(db: Database) {
  return defineRoute({
    method: 'get',
    path: '/billing/subscription',
    operationId: 'getBillingSubscription',
    tags: ['Billing'],
    summary: "The workspace's current subscription (x-workspace-id header)",
    middleware: [requireWorkspace(db)],
    responses: {
      200: {
        description: 'The current subscription, or null on the free plan',
        content: { 'application/json': { schema: BillingSubscriptionResponseSchema } },
      },
      ...problemResponses(401, 403, 422, 429),
    },
  });
}

const iso = (value: Date | null) => (value === null ? null : value.toISOString());

export function billingRouter(db: Database): AppRouter {
  const plans = PLAN_CATALOGUE.filter((plan) => plan.active).map((plan) => ({
    id: plan.id,
    name: plan.name,
    kind: plan.kind,
    interval: plan.interval,
    pricePaise: plan.pricePaise,
    perSeat: plan.perSeat,
    clerkSeatPricePaise: plan.clerkSeatPricePaise,
    minSeats: plan.minSeats,
  }));

  return createRouter()
    .openapi(listBillingPlansRoute, (c) => c.json({ data: plans }, 200))
    .openapi(billingSubscriptionRoute(db), async (c) => {
      const workspaceId = c.var.workspaceId;
      const row = await c.var.withWorkspace((tx) => loadSubscription(tx, workspaceId));
      const subscription: BillingSubscription | null = row && {
        id: row.id,
        planId: row.planId,
        status: row.status as BillingSubscription['status'],
        seats: row.seats,
        clerkSeats: row.clerkSeats,
        currentPeriodStart: iso(row.currentPeriodStart),
        currentPeriodEnd: iso(row.currentPeriodEnd),
        graceUntil: iso(row.graceUntil),
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      };
      return c.json({ subscription }, 200);
    });
}
