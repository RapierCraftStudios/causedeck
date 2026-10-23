// The email sender allow-list (#528): exact and domain patterns, envelope sender or forwarding
// user, SPF/DKIM/DMARC not FAIL for non-self senders, quarantine with no parsing.
import { describe, expect, it } from 'vitest';

import { evaluateSender, matchesPattern } from '../allow-list.ts';
import { parseEmail } from '../mime.ts';

import { ALLOW_LIST, fixture, intake } from './helpers.ts';

describe('matchesPattern', () => {
  it('matches an exact address or a domain and its subdomains', () => {
    expect(matchesPattern('A@Court.test', 'a@court.test')).toBe(true);
    expect(matchesPattern('x@court.test', '@court.test')).toBe(true);
    expect(matchesPattern('x@mail.court.test', '*@court.test')).toBe(true);
    expect(matchesPattern('x@notcourt.test', '@court.test')).toBe(false);
    expect(matchesPattern('x@court.test', 'y@court.test')).toBe(false);
  });
});

describe('evaluateSender', () => {
  it('quarantines a sender that is on no list', async () => {
    const email = await parseEmail(fixture('injection'));
    expect(evaluateSender(email, [])).toEqual({
      verdict: 'quarantine',
      reason: 'sender_not_allowed',
      failed: [],
    });
  });

  it('matches the forwarding user when the envelope sender is not listed', async () => {
    const email = await parseEmail(fixture('forward-gmail'));
    expect(evaluateSender(email, ALLOW_LIST)).toMatchObject({ verdict: 'allowed', kind: 'self' });
  });

  it('quarantines a spoofed sender whose SPF and DMARC fail, with no parsing', async () => {
    const outcome = await intake('spoofed-sender');
    expect(outcome).toEqual({
      status: 'quarantined',
      verdict: { verdict: 'quarantine', reason: 'auth_failed', failed: ['spf', 'dmarc'] },
    });
  });

  it('does not check auth for the lawyer themselves', async () => {
    const email = await parseEmail(fixture('forward-gmail'));
    const failing = { ...email, auth: { spf: 'fail', dkim: 'fail', dmarc: 'fail' } as const };
    expect(evaluateSender(failing, ALLOW_LIST)).toMatchObject({ verdict: 'allowed', kind: 'self' });
  });
});
