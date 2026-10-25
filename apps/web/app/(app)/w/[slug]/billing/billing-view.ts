// The billing page's view model (#256): what to show for the workspace's subscription, seats and
// invoices, with every amount formatted by `formatInr` (integer paise, Indian grouping) and every
// date as `dd MMM yyyy` in IST (`formatDate`). Pure, so the states are unit-testable without a
// database; the page loads the rows and the components only translate and lay out.
//
// The DB has no mandate column, so the UPI Autopay state is derived from the subscription:
// `trialing` is the provider's `created` (mandate not yet approved), `past_due`/`paused` or an open
// dunning episode is a failed payment, and `grace_until` on a `past_due` row is the grace period
// (`@causedeck/billing/state-machine`).
//
// `manage` (#257) carries what the owner billing actions need: the current counts, the GSTIN, the
// cancel/pause flags and the plans the owner can move to.
import { getPlan, PLAN_CATALOGUE, type Plan } from '@causedeck/billing/plans';
import { formatDate, formatInr, IST_TIME_ZONE, type Locale } from '@causedeck/i18n';

export interface BillingSubscriptionInput {
  planId: string;
  status: string;
  seats: number;
  clerkSeats: number;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  cancelAtPeriodEnd: boolean;
  dunningStartedAt: Date | null;
  /** The workspace's GSTIN for future invoices (#257). */
  gstin?: string | null;
}

export interface BillingInvoiceInput {
  id: string;
  number: string;
  /** `yyyy-mm-dd`. */
  issueDate: string;
  status: 'issued' | 'paid' | 'void';
  totalPaise: number;
  pdfBlobId: string | null;
}

export interface BillingViewInput {
  slug: string;
  subscription: BillingSubscriptionInput | null;
  /** Active members holding a seat: clerks apart from everyone else (`countBillableSeats`). */
  seatsUsed: { nonClerk: number; clerk: number };
  invoices: readonly BillingInvoiceInput[];
  now: Date;
  locale: Locale;
  plans?: readonly Plan[];
}

export type PaymentMethodState = 'active' | 'pending' | 'failed';

export type PlanStatus =
  | { key: 'active' | 'pending' | 'pastDue' | 'paused' | 'cancelled' }
  | { key: 'grace' | 'cancelsOn'; date: string };

export type Renewal = { key: 'renewal' | 'endsOn'; date: string } | { key: 'noRenewal' };

export type BillingBanner =
  | { key: 'grace'; date: string; days: number }
  | { key: 'paymentFailed' }
  | { key: 'cancels'; date: string };

export interface InvoiceView {
  id: string;
  number: string;
  date: string;
  amount: string;
  status: BillingInvoiceInput['status'];
  /** The authorised PDF route (#258), only once the PDF has been rendered. */
  pdfHref: string | null;
}

export interface SeatsView {
  used: number;
  total: number;
  /** Null when the plan has no clerk seats. */
  clerks: { used: number; total: number } | null;
}

export interface PaidPlanView {
  name: string;
  /** The amount of one charge, ex-GST; null when the plan is not in the catalogue. */
  price: string | null;
  interval: 'month' | 'year';
  breakdown: { seats: number; seatPrice: string; clerkSeats: number; clerkPrice: string } | null;
}

export interface UpgradeOption {
  kind: 'advocate' | 'chamber';
  fromPrice: string;
  minSeats: number;
}

/** A plan the owner can move to (#257): active, paid, the same interval as the current plan. */
export interface PlanOption {
  id: string;
  name: string;
  kind: Plan['kind'];
  /** Per seat when `perSeat`, otherwise the flat price of one charge; ex-GST. */
  price: string;
  perSeat: boolean;
  minSeats: number;
  clerkSeats: boolean;
}

/** What the owner billing actions need (#257); shown only with `billing.manage`. */
export interface ManageView {
  planId: string;
  seats: number;
  clerkSeats: number;
  seatsUsed: { nonClerk: number; clerk: number };
  minSeats: number;
  clerkSeatsAvailable: boolean;
  gstin: string | null;
  cancelAtPeriodEnd: boolean;
  paused: boolean;
  /** The current period's end (`dd MMM yyyy`), when the cancel copy names it. */
  periodEnd: string | null;
  planOptions: PlanOption[];
}

export type BillingView =
  | { kind: 'junior'; upgrades: UpgradeOption[]; invoices: InvoiceView[] }
  | {
      kind: 'paid';
      plan: PaidPlanView;
      status: PlanStatus;
      renewal: Renewal;
      seats: SeatsView;
      paymentMethod: PaymentMethodState | null;
      banner: BillingBanner | null;
      invoices: InvoiceView[];
      manage: ManageView;
    };

const DAY_MS = 86_400_000;

/** The IST calendar day of `date`, as days since the epoch. */
function istDay(date: Date): number {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .split('-')
    .map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS);
}

/** Whole IST calendar days from `now` until `until`; 0 on the last day or after it. */
export function daysLeft(until: Date, now: Date): number {
  return Math.max(0, istDay(until) - istDay(now));
}

/** `active`, `pending` or `failed` UPI Autopay; null when there is nothing to pay. */
export function paymentMethodState(sub: BillingSubscriptionInput): PaymentMethodState | null {
  if (sub.status === 'cancelled' || sub.status === 'expired') return null;
  if (sub.status === 'past_due' || sub.status === 'paused' || sub.dunningStartedAt !== null)
    return 'failed';
  if (sub.status === 'trialing') return 'pending';
  return 'active';
}

function planStatus(sub: BillingSubscriptionInput, date: (d: Date) => string): PlanStatus {
  switch (sub.status) {
    case 'trialing':
      return { key: 'pending' };
    case 'past_due':
      return sub.graceUntil ? { key: 'grace', date: date(sub.graceUntil) } : { key: 'pastDue' };
    case 'paused':
      return { key: 'paused' };
    case 'cancelled':
    case 'expired':
      return { key: 'cancelled' };
    default:
      return sub.cancelAtPeriodEnd && sub.currentPeriodEnd
        ? { key: 'cancelsOn', date: date(sub.currentPeriodEnd) }
        : { key: 'active' };
  }
}

function renewal(sub: BillingSubscriptionInput, date: (d: Date) => string): Renewal {
  if (!sub.currentPeriodEnd) return { key: 'noRenewal' };
  const ends = sub.cancelAtPeriodEnd || sub.status === 'cancelled';
  return { key: ends ? 'endsOn' : 'renewal', date: date(sub.currentPeriodEnd) };
}

function banner(
  sub: BillingSubscriptionInput,
  now: Date,
  date: (d: Date) => string,
): BillingBanner | null {
  if (paymentMethodState(sub) === 'failed') {
    return sub.graceUntil
      ? { key: 'grace', date: date(sub.graceUntil), days: daysLeft(sub.graceUntil, now) }
      : { key: 'paymentFailed' };
  }
  if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd && sub.status !== 'cancelled')
    return { key: 'cancels', date: date(sub.currentPeriodEnd) };
  return null;
}

function paidPlan(sub: BillingSubscriptionInput, plans: readonly Plan[]): PaidPlanView {
  const plan = getPlan(sub.planId, [...plans]);
  if (!plan) return { name: sub.planId, price: null, interval: 'month', breakdown: null };
  const clerkPrice = plan.clerkSeatPricePaise ?? 0;
  const total = plan.perSeat
    ? plan.pricePaise * sub.seats + clerkPrice * sub.clerkSeats
    : plan.pricePaise;
  return {
    name: plan.name,
    price: formatInr(total),
    interval: plan.interval,
    breakdown: plan.perSeat
      ? {
          seats: sub.seats,
          seatPrice: formatInr(plan.pricePaise),
          clerkSeats: sub.clerkSeats,
          clerkPrice: formatInr(clerkPrice),
        }
      : null,
  };
}

function upgrades(plans: readonly Plan[]): UpgradeOption[] {
  return (['advocate', 'chamber'] as const).flatMap((kind) => {
    const monthly = plans.filter((p) => p.active && p.kind === kind && p.interval === 'month');
    if (monthly.length === 0) return [];
    const cheapest = monthly.reduce((a, b) => (b.pricePaise < a.pricePaise ? b : a));
    return [{ kind, fromPrice: formatInr(cheapest.pricePaise), minSeats: cheapest.minSeats }];
  });
}

function planOptions(current: Plan | undefined, plans: readonly Plan[]): PlanOption[] {
  return plans
    .filter(
      (p) =>
        p.active &&
        p.kind !== 'junior' &&
        p.pricePaise > 0 &&
        (current === undefined || p.interval === current.interval),
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      price: formatInr(p.pricePaise),
      perSeat: p.perSeat,
      minSeats: p.minSeats,
      clerkSeats: p.clerkSeatPricePaise !== null,
    }));
}

export function toBillingView(input: BillingViewInput): BillingView {
  const { subscription: sub, slug, now, locale } = input;
  const plans = input.plans ?? PLAN_CATALOGUE;
  const date = (d: Date | string) => formatDate(d, { locale });
  const invoices = input.invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    date: date(invoice.issueDate),
    amount: formatInr(invoice.totalPaise),
    status: invoice.status,
    pdfHref:
      invoice.pdfBlobId === null
        ? null
        : `/w/${encodeURIComponent(slug)}/billing/invoices/${encodeURIComponent(invoice.id)}/pdf`,
  }));

  if (sub === null || sub.status === 'expired' || sub.planId === 'junior') {
    return { kind: 'junior', upgrades: upgrades(plans), invoices };
  }
  const plan = getPlan(sub.planId, [...plans]);
  return {
    kind: 'paid',
    plan: paidPlan(sub, plans),
    status: planStatus(sub, date),
    renewal: renewal(sub, date),
    seats: {
      used: input.seatsUsed.nonClerk,
      total: sub.seats,
      clerks:
        (plan?.clerkSeatPricePaise ?? null) !== null || sub.clerkSeats > 0
          ? { used: input.seatsUsed.clerk, total: sub.clerkSeats }
          : null,
    },
    paymentMethod: paymentMethodState(sub),
    banner: banner(sub, now, date),
    invoices,
    manage: {
      planId: sub.planId,
      seats: sub.seats,
      clerkSeats: sub.clerkSeats,
      seatsUsed: input.seatsUsed,
      minSeats: plan?.minSeats ?? 1,
      clerkSeatsAvailable: (plan?.clerkSeatPricePaise ?? null) !== null,
      gstin: sub.gstin ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      paused: sub.status === 'paused',
      periodEnd: sub.currentPeriodEnd ? date(sub.currentPeriodEnd) : null,
      planOptions: planOptions(plan, plans),
    },
  };
}
