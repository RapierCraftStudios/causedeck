import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyExclusions, matchExclusions } from '../exclusions.ts';
import { parseWhatsAppExport } from '../parser.ts';

describe('matchExclusions', () => {
  it.each([
    ['Aadhaar 2345 6789 0123', 'aadhaar'],
    ['aadhaar 234567890123', 'aadhaar'],
    ['aadhaar 2345-6789-0123', 'aadhaar'],
    ['PAN ABCDE1234F', 'pan'],
    ['pan abcde1234f', 'pan'],
    ['A/c no 123456789012', 'bank_account'],
    ['account number: 00112233445566', 'bank_account'],
    ['Acct. # 123 456 7890', 'bank_account'],
    ['IFSC HDFC0001234', 'ifsc'],
    ['ifsc sbin0004567', 'ifsc'],
    ['OTP is 482913', 'credential_phrase'],
    ['the password is hunter2', 'credential_phrase'],
    ['UPI PIN 1234', 'credential_phrase'],
    ['This is a POCSO matter', 'sensitive_keyword'],
    ['in camera hearing', 'sensitive_keyword'],
  ] as const)('%s trips %s', (text, rule) => {
    expect(matchExclusions(text)).toContain(rule);
  });

  it.each([
    'Lunch at 1?',
    'Hearing on 12/10/2026 at 10:30',
    'Call me on 9876543210',
    'Pincode 560001',
    'Please archive the file',
    'Case 123/2026 listed',
    '1234 5678 9012',
  ])('%s trips nothing', (text) => {
    expect(matchExclusions(text)).toEqual([]);
  });

  it('matches sensitive matter case numbers ignoring spacing and punctuation', () => {
    const options = { sensitiveCaseNumbers: ['CRL.A. 123/2026'] };
    expect(matchExclusions('crl a 123 / 2026 adjourned', options)).toEqual(['sensitive_matter']);
    expect(matchExclusions('CRL.A. 124/2026 adjourned', options)).toEqual([]);
    expect(matchExclusions('x 12', { sensitiveCaseNumbers: ['12'] })).toEqual([]);
  });

  it('lets the caller replace the keyword list', () => {
    expect(matchExclusions('pocso', { sensitiveKeywords: ['custody'] })).toEqual([]);
    expect(matchExclusions('custody battle', { sensitiveKeywords: ['custody'] })).toEqual([
      'sensitive_keyword',
    ]);
  });
});

describe('applyExclusions', () => {
  const pii = parseWhatsAppExport(
    readFileSync(path.resolve(import.meta.dirname, '../../../fixtures/whatsapp/pii.txt'), 'utf8'),
  ).messages;
  const options = { sensitiveCaseNumbers: ['CRL.A. 123/2026'] };

  it('holds back every sensitive message in the PII fixture', () => {
    const { kept, excluded } = applyExclusions(pii, options);
    expect(kept.map((m) => m.text)).toEqual(['Lunch at 1?']);
    expect(excluded.map((e) => e.rules[0])).toEqual([
      'aadhaar',
      'pan',
      'bank_account',
      'credential_phrase',
      'sensitive_keyword',
      'sensitive_matter',
    ]);
    expect(excluded.find((e) => e.index === 2)?.rules).toEqual(['bank_account', 'ifsc']);
  });

  it('releases a confirmed overridable match but never Aadhaar or credentials', () => {
    const confirmed = new Set(pii.map((m) => m.index));
    const { kept, excluded } = applyExclusions(pii, options, confirmed);
    expect(excluded.map((e) => e.rules[0])).toEqual(['aadhaar', 'credential_phrase']);
    expect(kept).toHaveLength(5);
  });

  it('checks attachment file names too', () => {
    const [m] = parseWhatsAppExport(
      '12/10/2026, 10:01 - Asha: ABCDE1234F.pdf (file attached)',
    ).messages;
    expect(applyExclusions([m!]).excluded).toHaveLength(1);
  });
});
