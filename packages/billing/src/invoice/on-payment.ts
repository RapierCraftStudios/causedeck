// Issuing the SaaS invoice for a paid charge (#255, #29). `billing.process-event` calls
// `invoiceOnPayment` for every `subscription.charged` event the state machine accepts, inside the
// transaction that marks the event processed, so the invoice and the event commit together.
//
// Idempotent per provider payment id: the payment already has an invoice → that invoice is
// returned and nothing is written. The database backs this with a unique index on
// (workspace_id, provider_payment_id). Lines come from the plan and seats after the charge, ex-GST;
// `issueInvoice` adds GST. A free or unknown plan gets no invoice.
//
// Refunds are not handled here: credit notes are deferred (docs/engineering/gst-invoicing.md). A
// wrong invoice is corrected by void and reissue.
import { getPlan } from '../plans';
import type { RazorpayWebhookEvent } from '../provider/types';

import {
  issueInvoice,
  type InvoiceStore,
  type IssueInvoiceContext,
  type SaasInvoiceLineInput,
} from './generate';
import { invoiceIssueDate } from './numbering';

export interface OnPaymentStore extends InvoiceStore {
  /** The invoice already issued for `providerPaymentId` in the current workspace, if any. */
  findByPaymentId(providerPaymentId: string): Promise<{ id: string } | null>;
}

export interface OnPaymentContext extends Omit<IssueInvoiceContext, 'store'> {
  store: OnPaymentStore;
}

export interface OnPaymentInput {
  event: RazorpayWebhookEvent;
  subscriptionId: string;
  /** The subscription after the charge was applied. */
  planId: string;
  seats: number;
  clerkSeats: number;
  periodStart: Date | string;
  periodEnd: Date | string;
}

export interface OnPaymentResult {
  invoiceId: string;
  /** False when the payment already had an invoice. */
  created: boolean;
}

/** The provider payment id of a captured `subscription.charged` event, else null. */
export function chargedPaymentId(event: RazorpayWebhookEvent): string | null {
  if (event.event !== 'subscription.charged') return null;
  const payment = event.payload.payment?.entity;
  if (!payment || payment.status !== 'captured' || payment.id === '') return null;
  return payment.id;
}

/** The invoice lines for one period of `planId`, or null when the plan bills nothing. */
export function chargeLines(
  input: Pick<OnPaymentInput, 'planId' | 'seats' | 'clerkSeats' | 'periodStart' | 'periodEnd'>,
): SaasInvoiceLineInput[] | null {
  const plan = getPlan(input.planId);
  if (!plan || plan.pricePaise <= 0) return null;
  const period = `${dateOf(input.periodStart)} to ${dateOf(input.periodEnd)}`;
  const lines: SaasInvoiceLineInput[] = [
    {
      description: plan.perSeat ? `${plan.name}, seats, ${period}` : `${plan.name}, ${period}`,
      quantity: plan.perSeat ? Math.max(input.seats, 1) : 1,
      unitPricePaise: plan.pricePaise,
    },
  ];
  if (plan.clerkSeatPricePaise !== null && input.clerkSeats > 0) {
    lines.push({
      description: `${plan.name}, clerk seats, ${period}`,
      quantity: input.clerkSeats,
      unitPricePaise: plan.clerkSeatPricePaise,
    });
  }
  return lines;
}

function dateOf(value: Date | string): string {
  return value instanceof Date ? invoiceIssueDate(value) : value;
}

/**
 * Create and issue the invoice for a captured charge, once per payment. Null for anything that is
 * not a captured `subscription.charged` on a paid plan.
 */
export async function invoiceOnPayment(
  ctx: OnPaymentContext,
  input: OnPaymentInput,
): Promise<OnPaymentResult | null> {
  const providerPaymentId = chargedPaymentId(input.event);
  if (providerPaymentId === null) return null;
  const lines = chargeLines(input);
  if (lines === null) return null;

  const existing = await ctx.store.findByPaymentId(providerPaymentId);
  if (existing) return { invoiceId: existing.id, created: false };

  const invoice = await issueInvoice(ctx, {
    subscriptionId: input.subscriptionId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    lines,
    providerPaymentId,
  });
  return { invoiceId: invoice.id, created: true };
}
