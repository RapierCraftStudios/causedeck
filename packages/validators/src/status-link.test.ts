import { describe, expect, it } from 'vitest';

import { StatusLinkExtend, StatusLinkInput } from './status-link';

const base = {
  matterId: '11111111-1111-4111-8111-111111111111',
  clientContactId: '22222222-2222-4222-8222-222222222222',
  headline: 'Status as on 20 October',
  note: 'The matter is listed on 3 November. Your advocate will be in touch.',
};

describe('StatusLinkInput', () => {
  it('defaults to English and a seven day expiry', () => {
    const parsed = StatusLinkInput.parse(base);
    expect(parsed.language).toBe('en');
    expect(parsed.expiryDays).toBe(7);
  });

  it('caps the expiry at 30 days and rejects zero', () => {
    expect(StatusLinkInput.safeParse({ ...base, expiryDays: 30 }).success).toBe(true);
    expect(StatusLinkInput.safeParse({ ...base, expiryDays: 31 }).success).toBe(false);
    expect(StatusLinkInput.safeParse({ ...base, expiryDays: 0 }).success).toBe(false);
  });

  it('needs an authored headline and note, and refuses unknown keys', () => {
    expect(StatusLinkInput.safeParse({ ...base, note: '  ' }).success).toBe(false);
    expect(StatusLinkInput.safeParse({ ...base, headline: '' }).success).toBe(false);
    expect(StatusLinkInput.safeParse({ ...base, partyNames: ['A'] }).success).toBe(false);
  });

  it('accepts only EN, TA and KN and an ISO next date', () => {
    expect(StatusLinkInput.safeParse({ ...base, language: 'hi' }).success).toBe(false);
    expect(StatusLinkInput.safeParse({ ...base, nextDate: '3 Nov' }).success).toBe(false);
    expect(
      StatusLinkInput.safeParse({ ...base, nextDate: '2026-11-03', language: 'ta' }).success,
    ).toBe(true);
  });
});

describe('StatusLinkExtend', () => {
  it('limits the total to 30 days', () => {
    const linkId = base.matterId;
    expect(StatusLinkExtend.safeParse({ linkId, expiryDays: 30 }).success).toBe(true);
    expect(StatusLinkExtend.safeParse({ linkId, expiryDays: 45 }).success).toBe(false);
  });
});
