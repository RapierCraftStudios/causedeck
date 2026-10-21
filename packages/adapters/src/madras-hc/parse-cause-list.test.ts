// Madras HC cause-list parser (#396): halls, single and division benches with Chief Justice
// phrasing, list-type markers, mapped and open-enum headings, item numbers, parties, advocates with
// enrolment numbers, grouped case lines, `(MD)` rows, OCR repair, unparsed rows with anchors, empty
// and blank lists, HTML and PDF-layout input, parse health on the noisy fixtures, a 40-page bound
// and byte-identical output.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateParseHealth, parseRunMetrics } from '../health/monitor.ts';
import { layoutFromHtml } from '../layout/html.ts';
import { layoutFromPdf } from '../layout/pdf.ts';
import { FIXTURES_ROOT } from '../testing/golden.ts';
import { writeSyntheticPdf } from '../testing/synthetic.ts';
import { ParsedCauseListSchema, type ParsedCauseList, type ParserInput } from '../types.ts';

import { MADRAS_HC_CONFIG, MADRAS_HC_VERSION } from './config/adapter-config.ts';
import { MADRAS_HC_STAGE_MAP } from './config/stage-map.ts';
import { parseMadrasCauseList, repairCaseText } from './parse-cause-list.ts';
import {
  ADVOCATES,
  CHIEF_JUSTICE,
  JUDGES,
  mulberry32,
  PETITIONERS,
  pick,
  RESPONDENTS,
} from './synthetic/names.ts';

const FORUM = 'in.tn.madras-hc.principal.appellate';
const meta = { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: FORUM };
const options = { config: MADRAS_HC_CONFIG, version: MADRAS_HC_VERSION };
const DIR = path.join(FIXTURES_ROOT, 'in.tn.madras-hc.principal');

const parseText = (text: string): ParsedCauseList =>
  ParsedCauseListSchema.parse(parseMadrasCauseList({ kind: 'text', text, meta }, options));

const fixture = (name: string): ParsedCauseList => {
  const content = readFileSync(path.join(DIR, name), 'utf8');
  const input: ParserInput = name.endsWith('.html')
    ? { kind: 'html', html: content, layout: layoutFromHtml(content), meta }
    : { kind: 'text', text: content, meta };
  return ParsedCauseListSchema.parse(parseMadrasCauseList(input, options));
};

const health = (parsed: ParsedCauseList) => evaluateParseHealth(parseRunMetrics(parsed)).status;

describe('parseMadrasCauseList: list structure', () => {
  it('reads halls, benches, the list type and date, headings, items, parties and advocates', () => {
    const list = fixture('list-01-appellate-writ-daily.input.txt');
    expect(list).toMatchObject({
      adapterId: 'in.tn.madras-hc.principal',
      forumCode: FORUM,
      listDate: '2026-10-23',
      listDateAnchor: { page: 1, quote: 'DAILY CAUSE LIST FOR 23.10.2026', rowIndex: 0 },
      listType: 'daily',
      source: 'text',
      status: 'ok',
      unparsedRows: [],
    });
    expect(list.rows.map((row) => row.itemNo)).toEqual(['1', '2', '3', '4', '5', '12A']);
    const [first] = list.rows;
    expect(first).toMatchObject({
      anchor: {
        page: 1,
        quote: '1. W.P.No.12345 of 2026 and W.M.P.Nos.13001 & 13002 of 2026',
        rowIndex: 0,
      },
      confidence: 1,
      hallNo: '12',
      bench: 'THE HONOURABLE MR. JUSTICE A. FICTIONAL',
      caseTypeRaw: 'W.P.',
      caseType: 'WP',
      caseNumber: '12345',
      caseYear: 2026,
      matchKey: 'WP/12345/2026',
      stageRaw: 'FOR ADMISSION',
      stageNorm: 'admission',
      parties: 'Fictional Mills Ltd. vs The Secretary to Government (Fictional Department)',
      advocates: [
        {
          raw: 'Mr. R. Fictional (MS/123/1990)',
          aliases: ['R FICTIONAL', 'FICTIONAL R'],
          enrolmentNo: 'MS/123/1990',
        },
        { raw: 'Mr. P. Pretend, Govt. Advocate', aliases: ['P PRETEND GOVT', 'PRETEND GOVT P'] },
      ],
    });
    expect(first?.children?.map((child) => [child.matchKey, child.parentProceedingKey])).toEqual([
      ['WMP/13001/2026', 'WP/12345/2026'],
      ['WMP/13002/2026', 'WP/12345/2026'],
    ]);
    expect(list.rows.map((row) => row.stageNorm)).toEqual([
      'admission',
      'admission',
      'admission',
      'orders',
      'hearing',
      'hearing',
    ]);
    expect(list.halls).toHaveLength(1);
    expect(list.halls?.[0]?.lists[0]?.rows).toHaveLength(6);
  });

  it('joins division-bench lines, including Chief Justice phrasing, per hall', () => {
    const list = fixture('list-02-db-writ-appeals.input.txt');
    expect(list.halls?.map((hall) => [hall.hallNo, hall.bench])).toEqual([
      ['1', `${CHIEF_JUSTICE} AND THE HONOURABLE MR. JUSTICE C. IMAGINARY`],
      ['2', 'THE HONOURABLE MRS. JUSTICE B. EXAMPLE AND THE HONOURABLE MS. JUSTICE D. PRETEND'],
    ]);
    expect(list.rows.map((row) => [row.hallNo, row.matchKey, row.stageNorm])).toEqual([
      ['1', 'WA/501/2026', 'admission'],
      ['1', 'WA/502/2026', 'admission'],
      ['1', 'WA/410/2026', 'after_notice'],
      ['1', 'WA/411/2026', 'after_notice'],
      ['2', 'WA/77/2025', 'part_heard'],
    ]);
    // `W.A.Nos.410 and 411` is two cases on one printed line: both quote it.
    expect(list.rows[2]?.anchor.quote).toBe(list.rows[3]?.anchor.quote);
  });

  it.each([
    ['DAILY CAUSE LIST FOR 23.10.2026', 'daily'],
    ['ADVANCE CAUSE LIST FOR 23.10.2026', 'advance'],
    ['SUPPLEMENTARY CAUSE LIST FOR 23.10.2026', 'supplementary'],
    ['SPECIAL SITTING CAUSE LIST FOR 24.10.2026', 'special'],
  ])('reads the list-type marker in %s', (line, key) => {
    const list = parseText(`${line}\nCOURT No. 1\nFOR ADMISSION\n1. W.P.No.1 of 2026`);
    expect(list.listType).toBe(key);
    expect(list.rows).toHaveLength(1);
  });

  it.each([
    ['FOR ADMISSION', 'admission'],
    ['FOR ORDERS', 'orders'],
    ['FOR FINAL HEARING', 'hearing'],
    ['FRESH CASES', 'fresh'],
    ['AFTER NOTICE', 'after_notice'],
    ['PART HEARD', 'part_heard'],
    ['FOR MENTIONING', 'mentioning'],
    ['SUPPLEMENTARY LIST', 'supplementary'],
    ['ADVANCE LIST', 'advance'],
  ])('maps the heading %s to %s', (heading, key) => {
    const list = parseText(
      `CAUSE LIST FOR 23.10.2026\nCOURT No. 1\n${heading}\n1. W.P.No.1 of 2026`,
    );
    expect(list.rows[0]).toMatchObject({ stageRaw: heading, stageNorm: key });
    expect(list.diagnostics.unmappedHeadings).toEqual([]);
  });

  it('keeps every mapped stage key unverified in the stage map', () => {
    expect(MADRAS_HC_STAGE_MAP.map((entry) => entry.key)).toEqual([
      'admission',
      'orders',
      'hearing',
      'fresh',
      'after_notice',
      'part_heard',
      'mentioning',
      'supplementary',
      'advance',
    ]);
  });

  it('reads item numbers 1., 12A. and 5(a). and same-line parties', () => {
    const list = parseText(
      [
        'COURT No. 3',
        'FOR ORDERS',
        '1. W.P.No.10 of 2026  Fictional Mills Ltd. vs The Registrar',
        '12A. W.P.No.11 of 2026',
        '5(a). W.P.No.12 of 2026',
      ].join('\n'),
    );
    expect(list.rows.map((row) => row.itemNo)).toEqual(['1', '12A', '5(a)']);
    expect(list.rows[0]?.parties).toBe('Fictional Mills Ltd. vs The Registrar');
  });

  it('files Original Side applications within their suits', () => {
    const list = fixture('list-03-original-side.input.txt');
    expect(list.rows.map((row) => row.matchKey)).toEqual([
      'CS/9/2026',
      'CS/10/2026',
      'OSA/15/2026',
      'ARBOP/12/2026',
      'CS/120/2024',
    ]);
    expect(list.rows[0]?.children?.map((child) => child.matchKey)).toEqual([
      'OA/1/2026',
      'OA/2/2026',
    ]);
    expect(list.rows[1]?.children?.map((child) => child.matchKey)).toEqual(['APPL/33/2026']);
  });

  it('reads the criminal side with CRL OP, CRL MP, CRL RC and HCP', () => {
    const list = fixture('list-06-criminal-side.input.txt');
    expect(list.rows.map((row) => row.caseType)).toEqual(['CRLOP', 'CRLRC', 'HCP', 'CRLA']);
    expect(list.rows[0]?.children?.[0]?.matchKey).toBe('CRLMP/3/2026');
    expect(list.rows[2]?.children?.[0]?.matchKey).toBe('HCMP/1/2026');
    // `Mr. V. Madeup` is an advocate, though ` V. ` reads like the `v.` between parties.
    expect(list.rows[0]?.advocates?.map((a) => a.raw)).toEqual([
      'Mr. K. Kalpitham (MS/4567/2004)',
      'Mr. V. Madeup, Addl. Public Prosecutor',
    ]);
  });

  it('tags (MD) rows on a Principal Seat list instead of dropping them', () => {
    const list = fixture('list-07-madurai-md.input.txt');
    expect(list.rows.map((row) => [row.matchKey, row.seatSuffix, row.forumMismatch])).toEqual([
      ['WP(MD)/678/2026', 'MD', true],
      ['CRLOP(MD)/4321/2026', 'MD', true],
    ]);
  });

  it('skips repeated page headers and page numbers and continues a row across pages', () => {
    const list = fixture('list-08-multi-page.input.txt');
    expect(list.rows.map((row) => row.itemNo)).toEqual(['1', '2', '3', '4', '5', '1', '2']);
    const split = list.rows[2];
    expect(split?.anchor.page).toBe(1);
    expect(split?.parties).toBe(
      'Pretend Weavers Co-operative Society vs The Registrar, Fictional University',
    );
    expect(split?.advocates?.[0]?.enrolmentNo).toBe('MS/4567/2004');
    expect(list.rows[4]).toMatchObject({ anchor: { page: 2 }, stageNorm: 'orders' });
    expect(list.diagnostics.unmappedHeadings).toEqual([]);
  });

  it('reads `No./of` and slash variants and expands ranges', () => {
    const list = fixture('list-12-no-of-slash-variants.input.txt');
    expect(list.rows.map((row) => row.matchKey)).toEqual([
      'WP/12345/2026',
      'WP/678/2026',
      'WMP/13001/2026',
      'WMP/13002/2026',
      'WMP/13003/2026',
      'CRPNPD/44/2026',
      'SA/9/2025',
    ]);
  });

  it('reads HTML table rows with headings between tables', () => {
    const list = fixture('list-11-unknown-headings.input.html');
    expect(list.source).toBe('html');
    expect(list.rows.map((row) => [row.itemNo, row.matchKey, row.stageRaw])).toEqual([
      ['1', 'WP/700/2026', 'TO BE SPOKEN TO'],
      ['2', 'WP/701/2026', 'TO BE SPOKEN TO'],
      ['3', 'WP/702/2026', 'FOR DIRECTIONS REGARDING COMPLIANCE'],
      ['4', 'WP/703/2026', 'FOR ADMISSION'],
    ]);
    expect(list.rows[0]?.advocates?.map((a) => a.raw)).toEqual([
      'Ms. A. Example',
      'Mr. P. Pretend, Govt. Advocate',
    ]);
  });

  it('reads PDF layout pages, with the line box on the anchor', async () => {
    const pdf = await writeSyntheticPdf([
      [
        'DAILY CAUSE LIST FOR 23.10.2026',
        'COURT No. 12',
        'THE HONOURABLE MR. JUSTICE A. FICTIONAL',
        'FOR ADMISSION',
        '1. W.P.No.12345 of 2026',
        'Fictional Mills Ltd. vs The Secretary',
        'Mr. R. Fictional (MS/123/1990)',
      ],
    ]);
    const layout = await layoutFromPdf(pdf);
    const list = parseMadrasCauseList({ kind: 'layout', layout, meta }, options);
    expect(list.source).toBe('pdf');
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({
      matchKey: 'WP/12345/2026',
      parties: 'Fictional Mills Ltd. vs The Secretary',
      advocates: [{ enrolmentNo: 'MS/123/1990' }],
    });
    expect(list.rows[0]?.anchor.bbox).toBeDefined();
  });
});

describe('parseMadrasCauseList: degradation', () => {
  it('keeps unmapped headings verbatim and flags the list degraded', () => {
    const list = fixture('list-11-unknown-headings.input.html');
    expect(list.diagnostics.unmappedHeadings).toEqual([
      'TO BE SPOKEN TO',
      'FOR DIRECTIONS REGARDING COMPLIANCE',
    ]);
    expect(list.rows[0]?.stageNorm).toBeNull();
    expect(health(list)).toBe('degraded');
  });

  it('repairs OCR noise, returns unreadable rows with anchors, and flags the list degraded', () => {
    const list = fixture('list-09-ocr-noisy.input.txt');
    expect(list.rows.map((row) => row.matchKey)).toEqual([
      'WP/12345/2026',
      'WP/12346/2026',
      'WP/501/2026',
      null,
    ]);
    expect(list.rows[0]?.confidence).toBeLessThan(1);
    expect(list.rows[3]).toMatchObject({ caseTypeRaw: 'W.F.', caseType: null });
    expect(list.diagnostics.unknownCaseTypes).toEqual(['W.F.']);
    expect(list.diagnostics.hallsUnreadable).toEqual(['C0URT N0. l2']);
    expect(list.unparsedRows).toEqual([
      {
        anchor: { page: 1, quote: '4. W.P.No.### of 2026', rowIndex: 0 },
        text: '4. W.P.No.### of 2026',
        reason: 'case_number_unparseable',
      },
    ]);
    expect(evaluateParseHealth(parseRunMetrics(list))).toMatchObject({
      status: 'degraded',
      flags: ['unknown_case_type_ratio', 'missing_hall_headers'],
    });
  });

  it('repairs digits only inside numbers', () => {
    expect(repairCaseText('W.P.No.l2345 of 2O26')).toBe('W.P.No.12345 of 2026');
    expect(repairCaseText('WPNo.5O1 of 2026')).toBe('WP No.501 of 2026');
    expect(repairCaseText('W.P.No.12346of2026')).toBe('W.P.No.12346 of 2026');
    expect(repairCaseText('W.P.No.12345 of 2026 Lakshmi Oil Mills')).toBe(
      'W.P.No.12345 of 2026 Lakshmi Oil Mills',
    );
  });

  it('returns status empty, not failed, for a "no cases" list, and health is ok', () => {
    const list = fixture('list-10-no-cases.input.txt');
    expect(list).toMatchObject({ status: 'empty', rows: [], unparsedRows: [] });
    expect(list.diagnostics.hallsSeen).toEqual(['5']);
    expect(health(list)).toBe('ok');
  });

  it('returns status failed for a document with no text', () => {
    expect(parseText(' \n\f\n')).toMatchObject({ status: 'failed', rows: [] });
  });

  it('is ok on the clean fixtures', () => {
    for (const name of [
      'list-01-appellate-writ-daily.input.txt',
      'list-02-db-writ-appeals.input.txt',
      'list-05-supplementary.input.txt',
      'list-08-multi-page.input.txt',
    ]) {
      expect(health(fixture(name)), name).toBe('ok');
    }
  });

  it('never throws on arbitrary text', () => {
    for (const text of ['', '1.', 'COURT No.', '12A. and in with of / 2026', 'x'.repeat(5000)]) {
      expect(() => parseText(text)).not.toThrow();
    }
  });
});

/** A 40-page supplementary-plus-main list: 20 pages of the main list, then 20 supplementary. */
function fortyPageList(): string {
  const random = mulberry32(396);
  const pages: string[] = [];
  let item = 0;
  for (let page = 0; page < 40; page += 1) {
    const supplementary = page >= 20;
    const lines = [
      'HIGH COURT OF JUDICATURE AT MADRAS (FICTIONAL)',
      supplementary ? 'SUPPLEMENTARY CAUSE LIST FOR 23.10.2026' : 'DAILY CAUSE LIST FOR 23.10.2026',
      `COURT No. ${String(page + 1)}`,
      pick(random, JUDGES),
      supplementary ? 'SUPPLEMENTARY LIST' : 'FOR ADMISSION',
    ];
    for (let row = 0; row < 25; row += 1) {
      item += 1;
      const number = String(10_000 + item);
      lines.push(
        `${String(row + 1)}. W.P.No.${number} of 2026 and W.M.P.Nos.${number} & ${String(item + 50_000)} of 2026`,
        `   ${pick(random, PETITIONERS)} vs ${pick(random, RESPONDENTS)}`,
        `   ${pick(random, ADVOCATES)} / ${pick(random, ADVOCATES)}`,
      );
    }
    lines.push(`Page ${String(page + 1)} of 40`);
    pages.push(lines.join('\n'));
  }
  return pages.join('\f');
}

describe('parseMadrasCauseList: performance and determinism', () => {
  it('parses a 40-page supplementary-plus-main list in under 500 ms', () => {
    const text = fortyPageList();
    let best = Number.POSITIVE_INFINITY;
    let list: ParsedCauseList | undefined;
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now();
      list = parseMadrasCauseList({ kind: 'text', text, meta }, options);
      best = Math.min(best, performance.now() - start);
    }
    expect(list?.rows).toHaveLength(1000);
    expect(list?.listType).toBe('daily');
    expect(list?.rows.at(-1)?.stageNorm).toBe('supplementary');
    expect(best).toBeLessThan(500);
  });

  it('gives byte-identical output across runs with the same input', () => {
    const text = fortyPageList();
    const first = JSON.stringify(parseMadrasCauseList({ kind: 'text', text, meta }, options));
    const second = JSON.stringify(parseMadrasCauseList({ kind: 'text', text, meta }, options));
    expect(second).toBe(first);
    expect(fortyPageList()).toBe(text);
  });
});
