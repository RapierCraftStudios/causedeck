// `GET /v1/billing/plans`, `GET /v1/billing/subscription` and the Razorpay webhook ack (#204).
// Kept free of `@causedeck/billing` so the validators stay dependency-light; the values mirror
// `PLAN_KINDS`, `PLAN_INTERVALS` and `SUBSCRIPTION_STATUSES` there.
import { z } from 'zod';

export const BillingPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['junior', 'advocate', 'chamber', 'dedicated']),
  interval: z.enum(['month', 'year']),
  /** Integer paise, ex-GST; per seat when `perSeat`. */
  pricePaise: z.int().nonnegative(),
  perSeat: z.boolean(),
  clerkSeatPricePaise: z.int().nonnegative().nullable(),
  minSeats: z.int().positive(),
});

export const BillingPlansResponseSchema = z
  .object({ data: z.array(BillingPlanSchema) })
  .meta({ id: 'BillingPlans' });

export const BillingSubscriptionSchema = z.object({
  id: z.string(),
  planId: z.string(),
  status: z.enum(['trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired']),
  seats: z.int().positive(),
  clerkSeats: z.int().nonnegative(),
  currentPeriodStart: z.iso.datetime().nullable(),
  currentPeriodEnd: z.iso.datetime().nullable(),
  graceUntil: z.iso.datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});

export const BillingSubscriptionResponseSchema = z
  .object({ subscription: BillingSubscriptionSchema.nullable() })
  .meta({ id: 'BillingSubscription' });

export const RazorpayWebhookAckSchema = z
  .object({ received: z.literal(true), duplicate: z.boolean().optional() })
  .meta({ id: 'RazorpayWebhookAck' });

export type BillingPlan = z.infer<typeof BillingPlanSchema>;
export type BillingPlansResponse = z.infer<typeof BillingPlansResponseSchema>;
export type BillingSubscription = z.infer<typeof BillingSubscriptionSchema>;
export type BillingSubscriptionResponse = z.infer<typeof BillingSubscriptionResponseSchema>;
export type RazorpayWebhookAck = z.infer<typeof RazorpayWebhookAckSchema>;
