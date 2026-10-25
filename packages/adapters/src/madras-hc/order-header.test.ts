// Madras HC order header (#398): bench, order date (never an earlier-order date), one or many case
// numbers, order type and neutral citation.
import { describe, expect, it } from 'vitest';

import { ParsedOrderHeaderSchema, type ParserInput } from '../types.ts';

import { emptyOrderHeader, parseMadrasOrderHeader } from './order-header.ts';

const input = (text: string): ParserInput => ({
  kind: 'text',
  text,
  meta: { receivedAt: '2026-10-21T00:00:00Z', forumCode: 'in.tn.madras-hc.principal.appellate' },
});
const parse = (text: string) => ParsedOrderHeaderSchema.parse(parseMadrasOrderHeader(input(text)));

const order = (head: string[], title: string, body: string[]) =>
  ['IN THE HIGH COURT OF JUDICATURE AT MADRAS', ...head, title, ...body].join('\n');

describe('parseMadrasOrderHeader', () => {
  it('reads a single-judge daily order', () => {
    const header = parse(
      order(
        [
          'DATED: 21.10.2026',
          'CORAM',
          'THE HONOURABLE MR.JUSTICE A. FICTIONAL',
          'W.P.(MD)No.678 of 2026',
          'FICTIONAL ... Petitioner',
        ],
        'ORDER',
        ['Post on 12.11.2026.'],
      ),
    );
    expect(header).toMatchObject({
      caseTypeRaw: 'W.P.(MD)',
      caseType: 'WP',
      seatSuffix: 'MD',
      caseNumber: '678',
      caseYear: 2026,
      orderDate: '2026-10-21',
      bench: 'THE HONOURABLE MR.JUSTICE A. FICTIONAL',
      judges: ['THE HONOURABLE MR.JUSTICE A. FICTIONAL'],
      orderType: 'daily',
      neutralCitation: null,
      anchor: { page: 1, quote: 'W.P.(MD)No.678 of 2026', rowIndex: 4 },
      confidence: 1,
    });
  });

  it('reads a division bench and many case numbers', () => {
    const header = parse(
      order(
        [
          'DATED: 21.10.2026',
          'CORAM: THE HONOURABLE THE CHIEF JUSTICE',
          'AND',
          "THE HON'BLE MS.JUSTICE B. FICTIONAL",
          'W.A.Nos.10 and 11 of 2026',
          'and W.A.M.P.No.5 of 2026',
        ],
        'COMMON ORDER',
        ['Both the writ appeals are dismissed.'],
      ),
    );
    expect(header.judges).toEqual([
      'THE HONOURABLE THE CHIEF JUSTICE',
      "THE HON'BLE MS.JUSTICE B. FICTIONAL",
    ]);
    expect(header.bench).toBe(
      "THE HONOURABLE THE CHIEF JUSTICE AND THE HON'BLE MS.JUSTICE B. FICTIONAL",
    );
    expect(header.caseRefs?.map((ref) => ref.matchKey)).toEqual(['WA/10/2026', 'WA/11/2026']);
    expect(header.caseRefs?.[1]?.children?.map((ref) => ref.matchKey)).toEqual(['WAMP/5/2026']);
    expect(header.orderType).toBe('final');
  });

  it.each([
    ['JUDGMENT', ['The appeal is allowed.'], 'judgment'],
    ['J U D G M E N T', [], 'judgment'],
    ['COMMON JUDGMENT', [], 'judgment'],
    ['ORDER', ['The writ petition is disposed of.'], 'final'],
    ['ORDER', ['There shall be an order of ad-interim injunction.'], 'interim'],
    ['ORDER', ['Learned counsel seeks time.'], 'daily'],
  ] as const)('title %s with %j is %s', (title, body, type) => {
    expect(
      parse(order(['DATED: 21.10.2026', 'W.P.No.1 of 2026'], title, [...body])).orderType,
    ).toBe(type);
  });

  it('normalises the neutral citation and keeps the printed form', () => {
    const header = parse(
      order(['2026/MHC/0789', 'DATED: 21.10.2026', 'W.P.No.1 of 2026'], 'JUDGMENT', []),
    );
    expect(header.neutralCitation).toBe('2026:MHC:789');
    expect(header.neutralCitationRaw).toBe('2026/MHC/0789');
    expect(header.caseRefs).toHaveLength(1);
  });

  it('never returns an earlier-order date as the order date', () => {
    const decoy = parse(
      order(['W.P.No.12777 of 2026'], 'ORDER', [
        'DATED: 03.03.2019',
        'By an order dated 03.03.2019 in W.P.No.999 of 2019 this Court directed consideration.',
      ]),
    );
    expect(decoy.orderDate).toBeNull();
    expect(decoy.caseRefs?.map((ref) => ref.matchKey)).toEqual(['WP/12777/2026']);
    const dated = parse(
      order(['Date of order : 21.10.2026', 'W.P.No.12777 of 2026'], 'ORDER', [
        'order dated 03.03.2019.',
      ]),
    );
    expect(dated.orderDate).toBe('2026-10-21');
  });

  it('returns the empty header for empty or unrecognised input, never throwing', () => {
    expect(parse('')).toEqual(emptyOrderHeader());
    expect(parse('lorem ipsum\f\f')).toEqual(emptyOrderHeader());
    expect(() => parse('x'.repeat(100_000))).not.toThrow();
  });
});
