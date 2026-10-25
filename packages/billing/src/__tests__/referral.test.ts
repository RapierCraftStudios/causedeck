import { describe, expect, it } from 'vitest';

import {
  decideReferralCredit,
  grantReferralCredit,
  MAX_CREDITED_REFERRALS_PER_YEAR,
  REFERRAL_CREDIT_MONTHS,
  type ReferralFacts,
} from '../referral';

const day = 24 * 60 * 60 * 1000;
const shareAt = new Date('2026-10-01T00:00:00Z');
const base: ReferralFacts = {
  referrerUserId: 'a',
  inviteeUserId: 'b',
  inviteeCreatedAt: new Date(shareAt.getTime() + day),
  shareCreatedAt: shareAt,
  alreadyCredited: false,
  referrerCreditedLastYear: 0,
};

describe('decideReferralCredit', () => {
  it('grants a free month to both sides', () => {
    expect(decideReferralCredit(base)).toEqual({
      grant: true,
      credits: [
        { side: 'referrer', userId: 'a', months: REFERRAL_CREDIT_MONTHS },
        { side: 'invitee', userId: 'b', months: REFERRAL_CREDIT_MONTHS },
      ],
    });
  });

  it.each([
    ['SELF_REFERRAL', { inviteeUserId: 'a' }],
    ['ALREADY_CREDITED', { alreadyCredited: true }],
    ['NOT_NEW_USER', { inviteeCreatedAt: new Date(shareAt.getTime() - day) }],
    ['NOT_NEW_USER', { inviteeCreatedAt: new Date(shareAt.getTime() + 31 * day) }],
    ['REFERRER_CAP_REACHED', { referrerCreditedLastYear: MAX_CREDITED_REFERRALS_PER_YEAR }],
  ] as const)('denies %s', (reason, patch) => {
    expect(decideReferralCredit({ ...base, ...patch })).toEqual({ grant: false, reason });
  });
});

describe('grantReferralCredit', () => {
  const sub = (end: Date | null) =>
    ({
      state: 'active',
      planId: 'solo',
      seats: 1,
      clerkSeats: 0,
      currentPeriodStart: null,
      currentPeriodEnd: end,
      graceUntil: null,
      cancelAtPeriodEnd: false,
      pendingSeats: null,
      providerSubscriptionId: null,
      providerCustomerId: null,
    }) as const;

  it('extends both subscriptions by a month and leaves a missing one pending', () => {
    const r = grantReferralCredit(base, {
      referrer: sub(new Date('2026-11-15T00:00:00Z')),
      invitee: null,
    });
    expect(r.grant).toBe(true);
    if (!r.grant) return;
    expect(r.applications[0].next?.currentPeriodEnd).toEqual(new Date('2026-12-15T00:00:00Z'));
    expect(r.applications[1].next).toBeNull();
  });

  it('denies like the policy', () => {
    expect(
      grantReferralCredit({ ...base, inviteeUserId: 'a' }, { referrer: null, invitee: null }),
    ).toEqual({ grant: false, reason: 'SELF_REFERRAL' });
  });
});
