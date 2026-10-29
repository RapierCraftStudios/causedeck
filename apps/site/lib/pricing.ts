// Pricing helpers (#91): sign-in links per plan, the SoftwareApplication offers JSON-LD and the
// chamber example, all derived from content/pricing.ts so no amount is written twice.
import { PLAN_PRICES, planPrice, type PlanId } from '../content/pricing.ts';

import { siteEnv } from './env.ts';
import { SITE_NAME } from './seo.ts';

/** Plan CTAs go to the app sign-in with the plan chosen; no payment is taken on the site. */
export function planSignInHref(plan: PlanId, appUrl: string = siteEnv.appUrl): string {
  return `${appUrl}/sign-in?plan=${plan}`;
}

/** Two free months against paying monthly, in paise per year (annual price is 10 monthly). */
export function annualSavingPaise(id: PlanId): number {
  const plan = planPrice(id);
  return plan.annualPaise === null ? 0 : plan.monthlyPaise * 12 - plan.annualPaise;
}

/** Monthly cost before GST of `seats` Chamber seats and one clerk seat. */
export function chamberExamplePaise(seats: number): number {
  const chamber = planPrice('chamber');
  return chamber.monthlyPaise * seats + (chamber.clerkSeatPaise ?? 0);
}

/** SoftwareApplication with offers: used on the pricing page only. Amounts are ex-GST rupees. */
export function pricingJsonLd(siteUrl: string = siteEnv.siteUrl): Record<string, unknown> {
  const offers = PLAN_PRICES.map((plan) => ({
    '@type': 'Offer',
    name: plan.id.charAt(0).toUpperCase() + plan.id.slice(1),
    price: (plan.monthlyPaise / 100).toFixed(2),
    priceCurrency: 'INR',
    url: `${siteUrl}/pricing/`,
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: `${siteUrl}/`,
    offers,
  };
}
