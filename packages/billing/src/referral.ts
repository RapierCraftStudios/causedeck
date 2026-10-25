// Referral credits (#507): a free month for the referrer and for the invitee once the invitee has
// activated, and the abuse limits that decide whether a referral earns anything. Pure policy: the
// referral rows and the ledger live in `@causedeck/core/shares`, which asks this module.

/** The free months each side earns. */
export const REFERRAL_CREDIT_MONTHS = 1;

/** A referrer earns at most this many credited referrals a year; more still onboard, unpaid. */
export const MAX_CREDITED_REFERRALS_PER_YEAR = 12;

/** An invitee must have created the account after the share link existed (a new user). */
export const REFERRAL_WINDOW_DAYS = 30;

export type ReferralDenial =
  | 'SELF_REFERRAL'
  | 'NOT_NEW_USER'
  | 'ALREADY_CREDITED'
  | 'REFERRER_CAP_REACHED';

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
  if (facts.referrerUserId === facts.inviteeUserId) return { grant: false, reason: 'SELF_REFERRAL' };
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
