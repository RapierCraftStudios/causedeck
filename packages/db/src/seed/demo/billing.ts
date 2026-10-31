// The billing rows of a demo workspace (#1071): an active subscription on the mock billing provider
// and three paid SaaS invoices (the current and the two previous periods), so the plan, seats,
// renewal and invoice cards of `/billing` have content. Like the e2e seed's, the subscription points
// at a plan of the catalogue (`plans` seeder, order 0) and at no real provider customer. Billing
// actions stay blocked in a demo workspace (`changeSubscription` refuses `is_demo`).
//
// Invoice numbers use the series `DEM`, apart from the real `CD` series, and are not taken from
// `invoice_counter`: the demo never moves the real counter. The parties are fictional and carry no
// GSTIN (unregistered), so nothing here looks like a tax document of a real business.
import { CLERK_SEAT_PRICE_PAISE, PLAN_CATALOGUE } from '@causedeck/validators/plans';

import type { subscription } from '../../schema/billing.ts';
import type { saasInvoice, saasInvoiceLine } from '../../schema/saas-invoice.ts';

import { addDays, demoId, ID_KIND, seedInstant } from './shared.ts';
import type { DemoWorkspaceSpec } from './workspaces.ts';

const GST_PERCENT = 18;
const SUPPLIER_STATE = '29';
export const DEMO_INVOICE_SERIES = 'DEM';
export const DEMO_BILLING_PERIOD_DAYS = 30;

export interface DemoBillingRows {
  subscriptions: (typeof subscription.$inferInsert)[];
  invoices: (typeof saasInvoice.$inferInsert)[];
  invoiceLines: (typeof saasInvoiceLine.$inferInsert)[];
}

/** Plan, seats and clerk seats of each demo workspace: a solo Advocate plan and a three-seat chamber. */
const SUBSCRIPTION_OF: Record<string, { planId: string; seats: number; clerkSeats: number }> = {
  'chennai-solo': { planId: 'advocate-monthly-2', seats: 1, clerkSeats: 0 },
  'bengaluru-chamber': { planId: 'chamber-seat-1', seats: 3, clerkSeats: 1 },
};

/** `26-27` for an issue date from 1 April 2026 to 31 March 2027. */
export function financialYear(date: string): string {
  const year = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? year : year - 1;
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  return `${yy(start)}-${yy(start + 1)}`;
}

export function demoBillingRows(ws: DemoWorkspaceSpec, today: string, at: Date): DemoBillingRows {
  const seeded = SUBSCRIPTION_OF[ws.key];
  const plan = PLAN_CATALOGUE.find((p) => p.id === seeded?.planId);
  if (seeded === undefined || plan === undefined) {
    throw new RangeError(`demo billing: no plan for workspace ${ws.key}`);
  }
  const did = (kind: number, n: number) => demoId(kind, n, ws.index);
  const subscriptionId = did(ID_KIND.subscription, 1);
  const periodStart = addDays(today, -10);
  const periodEnd = addDays(periodStart, DEMO_BILLING_PERIOD_DAYS);
  const rows: DemoBillingRows = {
    subscriptions: [
      {
        id: subscriptionId,
        workspaceId: ws.id,
        planId: plan.id,
        status: 'active',
        seats: seeded.seats,
        clerkSeats: seeded.clerkSeats,
        provider: 'mock',
        providerSubscriptionId: `sub_demo_${ws.key}`,
        providerCustomerId: `cust_demo_${ws.key}`,
        currentPeriodStart: seedInstant(periodStart),
        currentPeriodEnd: seedInstant(periodEnd),
        billingEmail: 'billing@demo.causedeck.test',
        createdAt: seedInstant(addDays(periodStart, -2 * DEMO_BILLING_PERIOD_DAYS)),
        updatedAt: at,
      },
    ],
    invoices: [],
    invoiceLines: [],
  };

  const interstate = ws.index === 0; // Chennai (33) buys from a Karnataka (29) supplier: IGST
  const lines = [
    {
      description: plan.perSeat
        ? `${plan.name}, ${String(seeded.seats)} seats`
        : `${plan.name}, one advocate`,
      quantity: plan.perSeat ? seeded.seats : 1,
      unitPricePaise: plan.pricePaise,
    },
    ...(seeded.clerkSeats > 0
      ? [
          {
            description: 'Clerk seat',
            quantity: seeded.clerkSeats,
            unitPricePaise: CLERK_SEAT_PRICE_PAISE,
          },
        ]
      : []),
  ].map((l) => ({ ...l, amountPaise: l.quantity * l.unitPricePaise }));
  const taxable = lines.reduce((sum, l) => sum + l.amountPaise, 0);
  const half = Math.round((taxable * GST_PERCENT) / 200);
  const tax = interstate
    ? { cgstPaise: 0, sgstPaise: 0, igstPaise: Math.round((taxable * GST_PERCENT) / 100) }
    : { cgstPaise: half, sgstPaise: half, igstPaise: 0 };
  const total = taxable + tax.cgstPaise + tax.sgstPaise + tax.igstPaise;
  const recipientState = interstate ? '33' : SUPPLIER_STATE;

  // Oldest first: the previous two periods and the current one, all paid at the start of the period.
  [2, 1, 0].forEach((periodsAgo, k) => {
    const start = addDays(periodStart, -periodsAgo * DEMO_BILLING_PERIOD_DAYS);
    const end = addDays(start, DEMO_BILLING_PERIOD_DAYS);
    const n = k + 1;
    const invoiceId = did(ID_KIND.saasInvoice, n);
    rows.invoices.push({
      id: invoiceId,
      workspaceId: ws.id,
      subscriptionId,
      number: `${DEMO_INVOICE_SERIES}/${financialYear(start)}/${String(ws.index * 100 + n).padStart(6, '0')}`,
      series: DEMO_INVOICE_SERIES,
      fy: financialYear(start),
      status: 'paid',
      issueDate: start,
      periodStart: start,
      periodEnd: end,
      supplier: {
        legalName: 'CauseDeck Demo Services (fictional)',
        address: 'Demo Street, Bengaluru (fictional)',
        gstin: null,
        stateCode: SUPPLIER_STATE,
      },
      recipient: {
        legalName: `${ws.name} (fictional)`,
        address: `${ws.practiceCity} (fictional)`,
        gstin: null,
        stateCode: recipientState,
      },
      placeOfSupplyStateCode: recipientState,
      taxablePaise: taxable,
      ...tax,
      totalPaise: total,
      providerPaymentId: `pay_demo_${ws.key}_${String(n)}`,
      createdAt: seedInstant(start),
    });
    lines.forEach((l, j) => {
      rows.invoiceLines.push({
        id: did(ID_KIND.saasInvoiceLine, n * 10 + j + 1),
        workspaceId: ws.id,
        invoiceId,
        ...l,
      });
    });
  });
  return rows;
}
