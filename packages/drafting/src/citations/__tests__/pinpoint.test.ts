import { describe, expect, it, vi } from 'vitest';

import { checkCitations } from '../check';
import { extractFromText } from '../extract';
import { classify, type ResolverHit } from '../match';
import type { CitationResolver } from '../resolvers/types';

const one = (text: string) => {
  const [item, ...rest] = extractFromText(text, 'b');
  expect(rest).toEqual([]);
  return item;
};

describe('case-number and section extraction', () => {
  it.each([
    ['W.P. No. 1234 of 2024', 'WP 1234/2024'],
    ['Crl.A. 56/2023', 'CRLA 56/2023'],
    ['W.P.(MD) No. 0099 of 2022', 'WP 99/2022'],
  ])('reads case number %s', (text, normalized) => {
    expect(one(text)).toMatchObject({ kind: 'case_number', normalized, raw: text });
  });

  it('ignores a number and year behind an unknown type', () => {
    expect(extractFromText('Sec. 5 of 2020 applies', 'b')).toEqual([]);
  });

  it.each([
    ['s. 106 BNS', 'BNS', '106'],
    ['Section 304A IPC', 'IPC', '304A'],
    ['u/s 420 IPC', 'IPC', '420'],
    ['section 482 of the Cr.P.C.', 'CRPC', '482'],
  ])('reads section %s', (text, statute, section) => {
    expect(one(text)).toMatchObject({
      kind: 'section',
      normalized: `${statute} s ${section}`,
      section: { statute, section },
    });
  });
});

describe('pinpoint and quote', () => {
  it.each([
    ['2023 INSC 123 para 12', { para: 12 }],
    ['2023 INSC 123, paras 12-14', { para: 12, paraEnd: 14 }],
    ['2023 INSC 123 at p. 7', { page: 7 }],
    ['2023 INSC 123 at page 7', { page: 7 }],
  ])('attaches the pinpoint of %s', (text, pinpoint) => {
    expect(one(text)?.pinpoint).toEqual(pinpoint);
  });

  it('attaches a straight or curly quote that follows, and keeps the span on the citation', () => {
    const a = one('2023 INSC 123 para 12 "the rule is clear"');
    expect(a).toMatchObject({
      quote: 'the rule is clear',
      pinpoint: { para: 12 },
      raw: '2023 INSC 123',
    });
    expect(one('2023 INSC 123, “held  so”')?.quote).toBe('held so');
  });

  it('ignores a quote that is not directly after the citation', () => {
    expect(one('2023 INSC 123 was cited. He said "no".')?.quote).toBeUndefined();
  });
});

describe('classification of masked hits and checks', () => {
  const hit: ResolverHit = {
    citation: 'WP 1/2024',
    title: 'X v. Y',
    sourceUrl: 'https://x.test/1',
  };
  const input = { normalized: 'WP 1/2024', kind: 'case_number' as const };
  const out = (h: Partial<ResolverHit>) =>
    classify(input, { kind: 'hits', hits: [{ ...hit, ...h }] });

  it('verifies a masked title on the exact match alone, and not otherwise', () => {
    expect(out({ titleMasked: true }).status).toBe('verified');
    expect(out({})).toMatchObject({ status: 'unknown', reason: 'title_missing' });
  });

  it.each(['pinpoint_not_found', 'quote_not_found'] as const)(
    'maps a failed check to %s',
    (reason) => {
      expect(out({ titleMasked: true, check: { quote: reason } })).toMatchObject({
        status: 'unknown',
        reason,
      });
    },
  );

  it('records a verified quote', () => {
    expect(out({ titleMasked: true, check: { quote: 'verified' } })).toMatchObject({
      status: 'verified',
      quoteChecked: 'verified',
    });
  });

  it('maps a section miss to section_not_found and other misses to plain not_found', () => {
    const miss = { kind: 'hits', hits: [] } as const;
    expect(classify({ normalized: 'IPC s 1', kind: 'section' }, miss)).toEqual({
      status: 'not_found',
      reason: 'section_not_found',
    });
    expect(classify(input, miss)).toEqual({ status: 'not_found' });
  });
});

describe('checkCitations', () => {
  it('sends pinpoint and quote to the resolver and drops the quote from the result', async () => {
    const resolve = vi.fn().mockResolvedValue({ kind: 'hits', hits: [] });
    const resolver: CitationResolver = { name: 't', external: false, resolve };
    const items = extractFromText('W.P. No. 1 of 2024 para 3 "text here"', 'b');
    const [checked] = await checkCitations(items, { resolver, workspaceId: 'w' });
    expect(resolve).toHaveBeenCalledWith({
      normalized: 'WP 1/2024',
      kind: 'case_number',
      pinpoint: { para: 3 },
      quote: 'text here',
    });
    expect(checked).toMatchObject({ resolved: false, verdict: { status: 'not_found' } });
    expect(checked).not.toHaveProperty('quote');
  });
});
