// The Karnataka HC PDF cause-list parser (#405) on inline FICTIONAL layouts: column clustering from
// header positions with x-jitter, List 1/2/3 kept apart, a hall spanning pages, continuation lines,
// unreadable pages, a 40-page list under 500 ms, determinism, and one pdf-lib PDF read end to end.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { layoutFromPdf } from '../layout/pdf.ts';
import {
  ParsedCauseListSchema,
  type LayoutDocument,
  type ParsedCauseList,
  type ParserInput,
} from '../types.ts';

import { createKarnatakaHcAdapter, KARNATAKA_HC_CONFIG, KARNATAKA_HC_VERSION } from './index.ts';
import { parseKarnatakaCauseListPdf } from './parse-cause-list-pdf.ts';

const FORUM = 'in.ka.karnataka-hc.bengaluru';
const CHAR = 5;
const HEIGHT = 10;
/** Column starts: Sl. No., Case No., Petitioner / Respondent, the two advocate columns. */
const X = { item: 40, case: 80, parties: 220, pet: 380, res: 480 } as const;

type Part = [x: number, text: string];
type LayoutPage = LayoutDocument['pages'][number];

/** A page of lines; each part is a run of words starting at its x. */
function page(number: number, lines: Part[][], textCoverage = 0.2): LayoutPage {
  const items: LayoutPage['items'] = [];
  const words: NonNullable<LayoutPage['words']> = [];
  for (const [index, parts] of lines.entries()) {
    const y = 40 + index * 14;
    let right = 0;
    for (const [x, text] of parts) {
      let offset = 0;
      for (const word of text.split(' ')) {
        if (word !== '') {
          words.push({
            text: word,
            bbox: { x: x + offset * CHAR, y, width: word.length * CHAR, height: HEIGHT },
          });
        }
        offset += word.length + 1;
      }
      right = Math.max(right, x + text.length * CHAR);
    }
    const left = Math.min(...parts.map(([x]) => x));
    items.push({
      text: parts.map(([, text]) => text).join(' '),
      bbox: { x: left, y, width: right - left, height: HEIGHT },
    });
  }
  return {
    page: number,
    width: 595,
    height: 842,
    text: items.map((item) => item.text).join('\n'),
    items,
    words,
    textCoverage,
  };
}

const header = (jitter = 0): Part[] => [
  [X.item + jitter, 'Sl. No.'],
  [X.case - jitter, 'Case No.'],
  [X.parties + jitter, 'Petitioner / Respondent'],
  [X.pet - jitter, 'Advocate for Petitioner'],
  [X.res + jitter, 'Advocate for Respondent'],
];

const row = (serial: string, caseNo: string, parties: string, jitter = 0): Part[] => [
  [X.item + jitter, serial],
  [X.case + jitter, caseNo],
  [X.parties - jitter, parties],
  [X.pet + jitter, 'Sri. A. Fictional'],
  [X.res - jitter, 'Smt. B. Madeup'],
];

function parse(pages: LayoutPage[], fileName?: string): ParsedCauseList {
  const input: ParserInput = {
    kind: 'layout',
    layout: { pages },
    meta: {
      receivedAt: '2026-10-21T20:00:00+05:30',
      forumCode: FORUM,
      ...(fileName === undefined ? {} : { fileName }),
    },
  };
  return ParsedCauseListSchema.parse(
    parseKarnatakaCauseListPdf(input, {
      config: KARNATAKA_HC_CONFIG,
      version: KARNATAKA_HC_VERSION,
    }),
  );
}

const TWO_PAGES = [
  page(1, [
    [[200, 'HIGH COURT OF KARNATAKA']],
    [[200, 'DAILY CAUSE LIST FOR 22-10-2026']],
    [[40, 'COURT HALL NO. 1']],
    [[260, 'LIST NO. 1']],
    [[200, "HON'BLE MR. JUSTICE A. FICTIONAL"]],
    header(),
    [[230, 'PRELIMINARY HEARING (B GROUP)']],
    row('1', 'WP No. 12345/2026', 'Arun Kavitham', 3),
    [[X.parties, 'vs State of Fictionland']],
    row('2', 'WA No. 100150 of 2024', 'Fictional Mills', -4),
    [[260, 'LIST NO. 2']],
    [[230, 'ADMISSION']],
    row('1', 'RFA No. 100/2024', 'P vs Q'),
  ]),
  page(2, [
    [[40, 'COURT HALL NO. 1']],
    header(2),
    row('2', 'RSA No. 5/2023', 'M vs N'),
    [[260, 'LIST NO. 3']],
    [[230, 'FOR BEING SPOKEN TO']],
    row('1', 'MFA No. 7/2022', 'R vs S'),
    [[40, 'COURT HALL NO. 2']],
    [[200, "HON'BLE MRS. JUSTICE B. INVENTED"]],
    [[230, 'ORDERS']],
    row('1', 'CRL.P No. 100137 of 2025', 'T vs State'),
  ]),
];

describe('parseKarnatakaCauseListPdf (#405)', () => {
  it('clusters words into columns from header positions, tolerating +/-4 px of jitter', () => {
    const list = parse(TWO_PAGES);
    expect(list.status).toBe('ok');
    expect(list.source).toBe('pdf');
    const [first, second] = list.rows;
    expect(first).toMatchObject({
      hallNo: '1',
      itemNo: '1',
      matchKey: 'WP/12345/2026',
      // The continuation line wraps the parties.
      parties: 'Arun Kavitham vs State of Fictionland',
      bench: "HON'BLE MR. JUSTICE A. FICTIONAL",
      stageNorm: 'preliminary_hearing_b_group',
      listType: 'daily',
    });
    expect(first?.advocates?.map((a) => a.raw)).toEqual(['Sri. A. Fictional', 'Smt. B. Madeup']);
    expect(first?.anchor).toMatchObject({
      page: 1,
      quote: '1 WP No. 12345/2026 Arun Kavitham Sri. A. Fictional Smt. B. Madeup',
    });
    expect(first?.anchor.bbox).toBeDefined();
    expect(second).toMatchObject({ matchKey: 'WA/100150/2024', benchNumbering: '100xxx' });
    expect(list.listDate).toBe('2026-10-22');
  });

  it('moves a word more than 4 px left of its column into the previous column', () => {
    const list = parse([
      page(1, [
        [[40, 'COURT HALL NO. 1']],
        header(),
        [
          [X.item, '1'],
          [X.case, 'WP No. 1/2026'],
          [X.parties, 'A vs B'],
          [X.pet - 10, 'Shifted'],
          [X.res, 'Smt. C'],
        ],
      ]),
    ]);
    expect(list.rows[0]?.parties).toBe('A vs B Shifted');
    expect(list.rows[0]?.advocates?.map((a) => a.raw)).toEqual(['Smt. C']);
  });

  it('keeps List 1/2/3 of a hall apart and merges the hall across pages', () => {
    const list = parse(TWO_PAGES);
    expect(list.diagnostics.hallsSeen).toEqual(['1', '2']);
    const hall = list.halls?.find((h) => h.hallNo === '1');
    expect(hall?.lists.map((l) => [l.listNo, l.rows.map((r) => r.matchKey)])).toEqual([
      ['1', ['WP/12345/2026', 'WA/100150/2024']],
      ['2', ['RFA/100/2024', 'RSA/5/2023']],
      ['3', ['MFA/7/2022']],
    ]);
    expect(list.rows.map((r) => r.listNo)).toEqual(['1', '1', '2', '2', '3', undefined]);
    // The heading of list 2 carries over to page 2, where hall 1 continues.
    expect(list.rows[3]).toMatchObject({ stageNorm: 'admission', anchor: { page: 2 } });
    expect(list.rows[5]).toMatchObject({
      hallNo: '2',
      stageNorm: 'orders',
      registryObjection: true,
      bench: "HON'BLE MRS. JUSTICE B. INVENTED",
    });
  });

  it('reads the list type from the file name when the title has none', () => {
    const pages = [
      page(1, [
        [[200, 'CAUSE LIST']],
        [[40, 'COURT HALL NO. 1']],
        header(),
        row('1', 'WP 1/2026', 'A'),
      ]),
    ];
    expect(parse(pages, 'supplementary-22-10-2026.pdf').listType).toBe('supplementary');
    expect(parse(pages).listType).toBeNull();
  });

  it('degrades: unreadable pages, a non-list document, zero rows and an empty list', () => {
    expect(parse([page(1, [], 0)]).status).toBe('failed');
    expect(parse([]).status).toBe('failed');
    expect(
      parse([page(1, [[[40, 'ORDER']], [[40, 'Heard the learned counsel for the parties.']]])])
        .status,
    ).toBe('not_a_cause_list');
    expect(parse([page(1, [[[40, 'COURT HALL NO. 1']], header()])]).status).toBe('failed');
    expect(parse([page(1, [[[40, 'COURT HALL NO. 1']], [[200, 'NIL']]])]).status).toBe('empty');
    const unparsed = parse([
      page(1, [[[40, 'COURT HALL NO. 1']], header(), row('1', 'pending', 'A vs B')]),
    ]);
    expect(unparsed.status).toBe('ok');
    expect(unparsed.unparsedRows?.[0]).toMatchObject({
      anchor: { page: 1, quote: '1 pending A vs B Sri. A. Fictional Smt. B. Madeup' },
      reason: 'case_number_unparseable',
    });
  });

  it('parses a 40-page list in under 500 ms and gives identical JSON for identical input', () => {
    const pages = Array.from({ length: 40 }, (_, index) =>
      page(index + 1, [
        [[40, `COURT HALL NO. ${String(index + 1)}`]],
        [[200, "HON'BLE MR. JUSTICE A. FICTIONAL"]],
        header(),
        [[230, 'FOR HEARING']],
        ...Array.from({ length: 30 }, (_, item) =>
          row(
            String(item + 1),
            `WP No. ${String(index * 100 + item + 1)}/2026`,
            'A vs B',
            (item % 9) - 4,
          ),
        ),
      ]),
    );
    parse(pages.slice(0, 2));
    const started = performance.now();
    const list = parse(pages);
    const elapsed = performance.now() - started;
    expect(list.rows).toHaveLength(1200);
    expect(elapsed).toBeLessThan(500);
    expect(JSON.stringify(parse(pages))).toBe(JSON.stringify(list));
  });

  it('reads a real PDF through layoutFromPdf and the adapter', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pdfPage = doc.addPage([595, 842]);
    const draw = (parts: Part[], y: number) => {
      for (const [x, text] of parts) pdfPage.drawText(text, { x, y: 842 - y, size: 8, font });
    };
    draw([[40, 'COURT HALL NO. 1']], 60);
    draw(header(), 80);
    draw([[230, 'ADMISSION']], 100);
    draw(row('1', 'WP No. 12345/2026', 'A vs B'), 120);
    const layout = await layoutFromPdf(await doc.save());
    const list = await createKarnatakaHcAdapter().parseCauseList({
      kind: 'layout',
      layout,
      meta: { receivedAt: '2026-10-21T20:00:00+05:30', forumCode: FORUM },
    });
    expect(list.rows.map((r) => [r.hallNo, r.matchKey, r.stageNorm, r.parties])).toEqual([
      ['1', 'WP/12345/2026', 'admission', 'A vs B'],
    ]);
  });
});
