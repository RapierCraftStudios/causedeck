// Karnataka HC order header (#406): the Karnataka preamble (court, `DATED THIS THE ... DAY OF ...`,
// `BEFORE` / `THE HON'BLE ... JUSTICE`, case line with category), case numbers, order date (never an
// earlier or impugned order's date), neutral citation and the reserved null `authenticityFlag`.
import { describe, expect, it } from 'vitest';

import { ParsedOrderHeaderSchema, type ParserInput } from '../types.ts';

import { emptyKarnatakaOrderHeader, parseKarnatakaOrderHeader } from './order-header.ts';

const input = (text: string): ParserInput => ({
  kind: 'text',
  text,
  meta: { receivedAt: '2026-10-22T00:00:00Z', forumCode: 'in.ka.karnataka-hc.bengaluru' },
});
const parse = (text: string) =>
  ParsedOrderHeaderSchema.parse(parseKarnatakaOrderHeader(input(text)));

const COURT = 'IN THE HIGH COURT OF KARNATAKA AT BENGALURU';
const PARTIES = ['BETWEEN:', 'SRI FICTIONAL PERSON ... PETITIONER', 'AND:', 'STATE ... RESPONDENT'];

describe('parseKarnatakaOrderHeader', () => {
  it('reads a single-judge writ order with its category', () => {
    const header = parse(
      [
        COURT,
        'DATED THIS THE 14TH DAY OF NOVEMBER, 2026',
        'BEFORE',
        "THE HON'BLE MR JUSTICE A. FICTIONAL",
        'WRIT PETITION NO. 12345 OF 2026 (GM-RES)',
        ...PARTIES,
        'Neutral Citation No. 2026:KHC:1234',
        'ORDER',
        'The petitioner challenges the impugned order dated 03.03.2019.',
        'List on 12.11.2026.',
      ].join('\n'),
    );
    expect(header).toMatchObject({
      caseTypeRaw: 'WRIT PETITION',
      caseType: 'WP',
      caseNumber: '12345',
      caseYear: 2026,
      orderDate: '2026-11-14',
      neutralCitation: '2026:KHC:1234',
      neutralCitationRaw: '2026:KHC:1234',
      bench: "THE HON'BLE MR JUSTICE A. FICTIONAL",
      judges: ["THE HON'BLE MR JUSTICE A. FICTIONAL"],
      orderType: 'daily',
      confidence: 1,
      authenticityFlag: null,
      anchor: { page: 1, quote: 'WRIT PETITION NO. 12345 OF 2026 (GM-RES)', rowIndex: 4 },
    });
    expect(header.caseRefs).toHaveLength(1);
    expect(header.caseRefs?.[0]).toMatchObject({ caseTypeCode: 'WP', subCategory: 'GM-RES' });
  });

  it('keeps 100xxx numbers opaque and reads a judge on the BEFORE line', () => {
    const header = parse(
      [
        COURT,
        'DATED: 14.11.2026',
        "BEFORE THE HON'BLE MRS JUSTICE B. FICTIONAL",
        'CRL.P No. 100137 of 2025',
        ...PARTIES,
        'ORDER',
      ].join('\n'),
    );
    expect(header).toMatchObject({
      caseType: 'CRLP',
      caseNumber: '100137',
      caseYear: 2025,
      orderDate: '2026-11-14',
      judges: ["THE HON'BLE MRS JUSTICE B. FICTIONAL"],
      neutralCitation: null,
    });
    expect(header.caseRefs?.[0]?.benchNumbering).toBe('100xxx');
  });

  it('reads a division-bench common judgment with connected cases', () => {
    const header = parse(
      [
        COURT,
        'DATED THIS THE 2ND DAY OF DECEMBER, 2026',
        'PRESENT',
        "THE HON'BLE MR. JUSTICE C. FICTIONAL",
        'AND',
        "THE HON'BLE MR. JUSTICE D. FICTIONAL",
        'WRIT APPEAL NO. 100150 OF 2024 C/W WRIT APPEAL NO. 100151 OF 2024',
        ...PARTIES,
        '2026:KHC-D:89-DB',
        'COMMON JUDGMENT',
        'The writ appeals are allowed.',
      ].join('\n'),
    );
    expect(header).toMatchObject({
      caseType: 'WA',
      caseNumber: '100150',
      orderDate: '2026-12-02',
      neutralCitation: '2026:KHC-D:89-DB',
      bench: "THE HON'BLE MR. JUSTICE C. FICTIONAL AND THE HON'BLE MR. JUSTICE D. FICTIONAL",
      orderType: 'judgment',
    });
    expect(header.caseRefs?.map((ref) => ref.number)).toEqual(['100150', '100151']);
  });

  it('files an IA under its main case', () => {
    const header = parse(
      [COURT, 'DATED: 14.11.2026', 'IA No. 1/2026 in WP No. 12345/2026', 'ORDER'].join('\n'),
    );
    expect(header.caseRefs).toHaveLength(1);
    expect(header.caseRefs?.[0]).toMatchObject({ caseTypeCode: 'WP', number: '12345' });
    expect(header.caseRefs?.[0]?.children?.[0]).toMatchObject({ caseTypeCode: 'IA', number: '1' });
  });

  it('never takes an earlier order date from the body as the order date', () => {
    const header = parse(
      [COURT, 'WP No. 12345/2026', 'ORDER', 'By order dated 01.10.2026 notice was issued.'].join(
        '\n',
      ),
    );
    expect(header.orderDate).toBeNull();
    expect(header.confidence).toBe(0.33);
  });

  it('reads the order type from the body', () => {
    const order = (body: string) => parse([COURT, 'WP No. 1/2026', 'ORDER', body].join('\n'));
    expect(order('The petition is disposed of.').orderType).toBe('final');
    expect(order('Interim order granted till the next date of hearing.').orderType).toBe('interim');
  });

  it.each(['', '   \n\n', 'A letter about something else entirely.'])(
    'returns the empty header for %j',
    (text) => {
      expect(parse(text)).toEqual(emptyKarnatakaOrderHeader());
      expect(emptyKarnatakaOrderHeader()).toMatchObject({
        authenticityFlag: null,
        caseRefs: [],
        confidence: 0,
      });
    },
  );
});
