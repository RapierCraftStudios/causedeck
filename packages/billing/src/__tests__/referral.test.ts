import { describe, expect, it } from 'vitest';

import {
  decideReferralCredit,
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
