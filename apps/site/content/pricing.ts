// Pricing page data and copy (#91). Every amount is integer paise, ex-GST, and lives only here.
// These are the catalogue's TEST prices (packages/validators/src/plans.ts, docs/engineering/
// billing.md): the founder and counsel confirm real pricing in #117, and `PRICES_CONFIRMED` stays
// false until then so the page says so. content/pricing.test.ts fails if this file drifts from the
// billing catalogue.
import { resolveCopy, type CopyLocale } from '../lib/copy.ts';

export const PRICES_CONFIRMED = false as boolean;
export const GST_RATE_PERCENT = 18;
export const MIN_CHAMBER_SEATS = 3;
/** UPI Autopay debits up to this much per charge without the payer approving each one. */
export const UPI_AUTOPAY_CAP_PAISE = 1_500_000;

export type PlanId = 'junior' | 'advocate' | 'chamber';

export interface PlanPrice {
  id: PlanId;
  /** Per month (per seat for Chamber), ex-GST. */
  monthlyPaise: number;
  /** Per year, ex-GST; null when the plan is billed monthly only. */
  annualPaise: number | null;
  /** Clerk seat per month, ex-GST (Chamber only). */
  clerkSeatPaise: number | null;
  minSeats: number;
  /** Active-matter limit; null is unlimited. */
  maxActiveMatters: number | null;
}

export const PLAN_PRICES: readonly PlanPrice[] = [
  {
    id: 'junior',
    monthlyPaise: 0,
    annualPaise: null,
    clerkSeatPaise: null,
    minSeats: 1,
    maxActiveMatters: 15,
  },
  {
    id: 'advocate',
    monthlyPaise: 49_900,
    annualPaise: 499_000,
    clerkSeatPaise: null,
    minSeats: 1,
    maxActiveMatters: null,
  },
  {
    id: 'chamber',
    monthlyPaise: 49_900,
    annualPaise: null,
    clerkSeatPaise: 19_900,
    minSeats: MIN_CHAMBER_SEATS,
    maxActiveMatters: null,
  },
];

export function planPrice(id: PlanId): PlanPrice {
  const found = PLAN_PRICES.find((plan) => plan.id === id);
  if (found === undefined) throw new Error(`Unknown plan ${id}`);
  return found;
}

export interface PlanCopy {
  name: string;
  tagline: string;
  features: string[];
  cta: string;
}

export interface CompareRow {
  label: string;
  junior: string;
  advocate: string;
  chamber: string;
}

export interface PricingCopy {
  metaTitle: string;
  metaDescription: string;
  title: string;
  intro: string;
  recommended: string;
  billingLegend: string;
  monthly: string;
  annual: string;
  perMonth: string;
  perYear: string;
  perSeatMonth: string;
  free: string;
  gstSuffix: string;
  annualSaving: string;
  billedMonthlyOnly: string;
  chamberSeats: string;
  clerkSeat: string;
  chamberExample: string;
  gstHeading: string;
  gstNote: string;
  autopayHeading: string;
  autopayNote: string;
  placeholderNote: string;
  compareHeading: string;
  compareLink: string;
  compareFeature: string;
  compareCaption: string;
  compareRows: CompareRow[];
  faqHeading: string;
  faq: { q: string; a: string }[];
  plans: Record<PlanId, PlanCopy>;
}

const en: PricingCopy = {
  metaTitle: 'Pricing',
  metaDescription:
    'CauseDeck plans for software seats: Junior, Advocate and Chamber with a clerk seat. Prices in rupees, GST extra, UPI Autopay supported.',
  title: 'Pricing for software seats',
  intro:
    'CauseDeck is software for advocates, priced per seat in rupees. A seat is a licence to use the software. It is never tied to a matter, a fee or an outcome.',
  recommended: 'Recommended',
  billingLegend: 'Billing period',
  monthly: 'Monthly',
  annual: 'Annual',
  perMonth: 'per month',
  perYear: 'per year',
  perSeatMonth: 'per seat per month',
  free: 'Free',
  gstSuffix: 'plus 18% GST',
  annualSaving: 'Two months free against paying monthly: you save {amount} a year.',
  billedMonthlyOnly: 'Billed monthly.',
  chamberSeats: 'Minimum {count} seats.',
  clerkSeat:
    'Clerk seat: {amount} per seat per month. Clerks work in the chamber workspace with restricted access to strategy notes.',
  chamberExample:
    'Example: {seats} advocate seats and one clerk seat come to {amount} a month before GST.',
  gstHeading: 'GST',
  gstNote:
    'All prices exclude GST. 18% GST is added on the invoice, and each invoice is a GST invoice for your workspace.',
  autopayHeading: 'Paying with UPI Autopay',
  autopayNote:
    'You can pay by UPI Autopay. You approve a mandate in your own UPI app through a link hosted by our payment provider, Razorpay. No payment is taken on this website and no card or bank details reach our servers. A mandate debits up to {cap} per charge without approval each time; a larger charge asks you to approve it in your UPI app.',
  placeholderNote:
    'These are launch test prices and are not final. Real pricing is confirmed before general availability, and the amounts here will change with it.',
  compareHeading: 'Compare plans',
  compareLink: 'Compare plans',
  compareFeature: 'Feature',
  compareCaption: 'Plan comparison',
  compareRows: [
    {
      label: 'Active matters',
      junior: 'Up to 15',
      advocate: 'Unlimited',
      chamber: 'Unlimited',
    },
    {
      label: 'Seats',
      junior: '1',
      advocate: '1',
      chamber: 'At least 3, plus clerk seats',
    },
    {
      label: 'Clerk seat',
      junior: 'Not included',
      advocate: 'Not included',
      chamber: 'Available per seat',
    },
    {
      label: 'Court-day board and briefs',
      junior: 'Included',
      advocate: 'Included',
      chamber: 'Included',
    },
    {
      label: 'Audit trail and 7-day undo',
      junior: 'Included',
      advocate: 'Included',
      chamber: 'Included',
    },
    {
      label: 'Export and delete your data',
      junior: 'Included',
      advocate: 'Included',
      chamber: 'Included',
    },
    {
      label: 'Capture and OCR',
      junior: 'Fair-use limits',
      advocate: 'No fixed limit',
      chamber: 'No fixed limit',
    },
    {
      label: 'Billing',
      junior: 'Free',
      advocate: 'Monthly or annual',
      chamber: 'Monthly',
    },
  ],
  faqHeading: 'Pricing questions',
  faq: [
    {
      q: 'What does a seat cost for?',
      a: 'A seat is access to the software for one person. Price depends on the plan and the number of seats only, never on the number of matters or on any fee you charge.',
    },
    {
      q: 'Is GST included?',
      a: 'No. Prices are before GST. 18% GST is added on the invoice.',
    },
    {
      q: 'Can I pay by UPI Autopay?',
      a: 'Yes. You approve the mandate in your UPI app. Payment is handled by Razorpay, not on this website.',
    },
    {
      q: 'Who is the Junior plan for?',
      a: 'An advocate starting out who wants to run a small set of matters. It is free, with up to 15 active matters and fair-use limits on capture and OCR.',
    },
    {
      q: 'Can a chamber add a clerk?',
      a: 'Yes. A clerk seat is a separate, lower-priced seat on the Chamber plan, with restricted access.',
    },
    {
      q: 'Can I export my data and leave?',
      a: 'Yes. Workspace owners can export everything and delete the workspace. See the security page for how.',
    },
  ],
  plans: {
    junior: {
      name: 'Junior',
      tagline: 'For an advocate starting out.',
      features: [
        'Up to 15 active matters',
        'Court-day board, cause lists and briefs',
        'Fair-use limits on capture and OCR',
      ],
      cta: 'Start free',
    },
    advocate: {
      name: 'Advocate',
      tagline: 'For a practising advocate.',
      features: [
        'Unlimited active matters',
        'No fixed limit on capture and OCR',
        'Audit trail and 7-day undo',
      ],
      cta: 'Choose Advocate',
    },
    chamber: {
      name: 'Chamber',
      tagline: 'For a chamber with juniors and a clerk.',
      features: [
        'Per-seat pricing, at least 3 seats',
        'A clerk seat with restricted access',
        'Roles and delegation across the chamber',
      ],
      cta: 'Choose Chamber',
    },
  },
};

export const PRICING_COPY: Record<CopyLocale, Partial<PricingCopy>> & { en: PricingCopy } = {
  en,
  ta: {},
  kn: {},
};

export function pricingCopy(locale: CopyLocale = 'en'): PricingCopy {
  return resolveCopy<PricingCopy>(PRICING_COPY, locale);
}

/** Replace `{name}` placeholders. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}
