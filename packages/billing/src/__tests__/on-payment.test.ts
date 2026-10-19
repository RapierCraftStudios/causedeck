// `invoiceOnPayment` (#255) over the in-memory store: a captured `subscription.charged` issues one
// invoice for the plan and seats after the charge, and the same payment never issues a second.
import { describe, expect, it } from 'vitest';

import { resolveSupplier, type SupplierConfig } from '../config/supplier';
import { chargeLines, invoiceOnPayment, type OnPaymentInput } from '../invoice/on-payment';
import { createMockBillingProvider } from '../provider/mock';
import type { RazorpayWebhookEvent } from '../provider/types';

import { createMemoryInvoiceStore } from './invoice-memory-store';

const SUPPLIER: SupplierConfig = resolveSupplier(
  { legalName: 'CauseDeck Technologies Pvt Ltd', address: 'Bengaluru', gstin: '29AAGCB7383J1Z4' },
  { nodeEnv: 'production' },
);

async function chargedEvent(
  event: 'subscription.charged' | 'payment.failed' = 'subscription.charged',
) {
  const provider = createMockBillingProvider();
  const customer = await provider.createCustomer({ email: 'accounts@example.in' });
  const sub = await provider.createSubscription({
    customerId: customer.id,
    planId: 'chamber-seat-1',
    quantity: 3,
  });
  await provider.authorizeMandate(sub.id);
  if (event === 'payment.failed') await provider.simulate(sub.id, 'subscription.charged');
  return provider.simulate(sub.id, event);
}

function setup() {
  const store = createMemoryInvoiceStore();
  store.recipients.set('sub-1', { name: 'Sharma Chambers', gstin: '29AAGCB7383J1Z4' });
  const ctx = {
    store,
    supplier: () => SUPPLIER,
    now: () => new Date('2026-04-02T06:00:00Z'),
  };
  return { store, ctx };
}

const input = (
  event: RazorpayWebhookEvent,
  over: Partial<OnPaymentInput> = {},
): OnPaymentInput => ({
  event,
  subscriptionId: 'sub-1',
  planId: 'chamber-seat-1',
  seats: 3,
  clerkSeats: 2,
  periodStart: '2026-04-01',
  periodEnd: '2026-04-30',
  ...over,
});

describe('invoiceOnPayment', () => {
  it('issues one invoice for a captured charge with the plan and seat lines', async () => {
    const { store, ctx } = setup();
    const event = await chargedEvent();
    const paymentId = event.payload.payment?.entity.id;

    const result = await invoiceOnPayment(ctx, input(event));

    expect(result).toEqual({ invoiceId: 'inv-1', created: true });
    expect(store.invoices).toHaveLength(1);
    const [invoice] = store.invoices;
    expect(invoice).toMatchObject({
      status: 'issued',
      number: 'CD/26-27/000001',
      providerPaymentId: paymentId,
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
    });
    // 3 × ₹499 + 2 × ₹199 = ₹1,895 ex-GST; intra-state (29 → 29) CGST + SGST at 9% each.
    expect(invoice?.lines.map((l) => [l.quantity, l.unitPricePaise])).toEqual([
      [3, 49_900],
      [2, 19_900],
    ]);
    expect(invoice?.taxablePaise).toBe(189_500);
    expect(invoice?.totalPaise).toBe(223_610);
  });

  it('returns the existing invoice when the same payment is processed again', async () => {
    const { store, ctx } = setup();
    const event = await chargedEvent();

    const first = await invoiceOnPayment(ctx, input(event));
    const second = await invoiceOnPayment(ctx, input(event));

    expect(second).toEqual({ invoiceId: first?.invoiceId, created: false });
    expect(store.invoices).toHaveLength(1);
    expect(store.counters.get('CD|26-27')).toBe(1);
  });

  it('issues nothing for a failed payment or another event', async () => {
    const { store, ctx } = setup();
    const failed = await chargedEvent('payment.failed');
    expect(await invoiceOnPayment(ctx, input(failed))).toBeNull();
    const charged = await chargedEvent();
    expect(
      await invoiceOnPayment(ctx, input({ ...charged, event: 'subscription.activated' })),
    ).toBeNull();
    const uncaptured = structuredClone(charged);
    if (uncaptured.payload.payment) uncaptured.payload.payment.entity.status = 'failed';
    expect(await invoiceOnPayment(ctx, input(uncaptured))).toBeNull();
    expect(store.invoices).toHaveLength(0);
  });

  it('issues nothing on a free or unknown plan', async () => {
    const { store, ctx } = setup();
    const event = await chargedEvent();
    expect(await invoiceOnPayment(ctx, input(event, { planId: 'junior' }))).toBeNull();
    expect(await invoiceOnPayment(ctx, input(event, { planId: 'no-such-plan' }))).toBeNull();
    expect(store.invoices).toHaveLength(0);
  });
});

describe('chargeLines', () => {
  it('bills a flat plan once and skips clerk seats it does not sell', () => {
    expect(
      chargeLines({
        planId: 'advocate-monthly-1',
        seats: 1,
        clerkSeats: 3,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
      }),
    ).toEqual([
      {
        description: 'Advocate 1 (monthly), 2026-04-01 to 2026-04-30',
        quantity: 1,
        unitPricePaise: 49_900,
      },
    ]);
  });
});
