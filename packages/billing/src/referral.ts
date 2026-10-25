// Referral credits (#507): a free month for the referrer and for the invitee once the invitee has
// activated, and the abuse limits that decide whether a referral earns anything. Pure policy: the
// referral rows and the ledger live in `@causedeck/core/shares`, which asks this module.

import { TERMINAL_STATES, type SubscriptionSnapshot } from './state-machine';
/** The free months each side earns. */
export const REFERRAL_CREDIT_MONTHS = 1;

/** A referrer earns at most this many credited referrals a year; more still onboard, unpaid. */
export const MAX_CREDITED_REFERRALS_PER_YEAR = 12;

/** An invitee must have created the account after the share link existed (a new user). */
export const REFERRAL_WINDOW_DAYS = 30;

export type ReferralDenial =
  'SELF_REFERRAL' | 'NOT_NEW_USER' | 'ALREADY_CREDITED' | 'REFERRER_CAP_REACHED';

export interface ReferralFacts {
  referrerUserId: string;
  inviteeUserId: string;
  /** When the invitee's account was created. */
  inviteeCreatedAt: Date;
  /** When the shared link was created. */
  shareCreatedAt: Date;
  /** Credits this referral already holds (idempotent re-activation). */
  alreadyCredited: boolean;
  /** Referrals of this referrer credited in the last 365 days. */
  referrerCreditedLastYear: number;
}

export interface ReferralCreditGrant {
  side: 'referrer' | 'invitee';
  userId: string;
  months: number;
}

export type ReferralDecision =
  | { grant: true; credits: [ReferralCreditGrant, ReferralCreditGrant] }
  | { grant: false; reason: ReferralDenial };

/** Whether an activated referral earns the free month on both sides, and who gets it. */
export function decideReferralCredit(facts: ReferralFacts): ReferralDecision {
  if (facts.referrerUserId === facts.inviteeUserId)
    return { grant: false, reason: 'SELF_REFERRAL' };
  if (facts.alreadyCredited) return { grant: false, reason: 'ALREADY_CREDITED' };
  const windowMs = REFERRAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const age = facts.inviteeCreatedAt.getTime() - facts.shareCreatedAt.getTime();
  if (age < 0 || age > windowMs) return { grant: false, reason: 'NOT_NEW_USER' };
  if (facts.referrerCreditedLastYear >= MAX_CREDITED_REFERRALS_PER_YEAR) {
    return { grant: false, reason: 'REFERRER_CAP_REACHED' };
  }
  return {
    grant: true,
    credits: [
      { side: 'referrer', userId: facts.referrerUserId, months: REFERRAL_CREDIT_MONTHS },
      { side: 'invitee', userId: facts.inviteeUserId, months: REFERRAL_CREDIT_MONTHS },
    ],
  };
}

/** A side's subscription before the credit, or null when that side has none yet (credit stays pending). */
export type ReferralSideSubscription = SubscriptionSnapshot | null;

export interface ReferralApplication extends ReferralCreditGrant {
  /** The subscription with the free months added, or null when there is no live one to extend. */
  next: SubscriptionSnapshot | null;
}

export type ReferralGrant =
  | { grant: true; applications: [ReferralApplication, ReferralApplication] }
  | { grant: false; reason: ReferralDenial };

/** The snapshot with its billing period (and so its next charge) pushed out by whole months. */
export function addFreeMonths(
  snapshot: SubscriptionSnapshot,
  months: number,
): SubscriptionSnapshot | null {
  if (TERMINAL_STATES.includes(snapshot.state) || snapshot.currentPeriodEnd === null) return null;
  const end = new Date(snapshot.currentPeriodEnd.getTime());
  end.setUTCMonth(end.getUTCMonth() + months);
  return { ...snapshot, currentPeriodEnd: end };
}

/**
 * Grant a free month to both sides: the policy (`decideReferralCredit`: idempotent per invitee,
 * per-referrer cap, self-referral denial) and the subscription each side ends up with. The caller
 * persists `next` and marks the credit applied; a side with no live subscription stays pending.
 */
export function grantReferralCredit(
  facts: ReferralFacts,
  subscriptions: { referrer: ReferralSideSubscription; invitee: ReferralSideSubscription },
): ReferralGrant {
  const decision = decideReferralCredit(facts);
  if (!decision.grant) return decision;
  const apply = (c: ReferralCreditGrant): ReferralApplication => {
    const current = subscriptions[c.side];
    return { ...c, next: current === null ? null : addFreeMonths(current, c.months) };
  };
  return { grant: true, applications: [apply(decision.credits[0]), apply(decision.credits[1])] };
}
