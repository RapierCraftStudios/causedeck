// The NCLT Bengaluru parser (#38, ADR 0020), one block per acceptance criterion: header detection,
// column clustering with tolerance, row fields and case numbers, nested IAs, coram and hearing
// metadata, counsel aliases, anchors and unparsed rows, OCR routing, access modes and performance.
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { defineAdapterConfig } from '../config/schema.ts';
import { layoutFromPdf } from '../layout/pdf.ts';
import type { LayoutDocument } from '../types.ts';

import {
  counselAliases,
  createNcltAdapter,
  NCLT_ACCESS_MODES,
  NCLT_COLUMN_KEYS,
  NCLT_CONFIG,
  NCLT_PREFIXES,
  parseNcltCaseNumber,
  parseNcltCaseNumbers,
  parseNcltCauseList,
  type NcltCauseList,
} from './index.ts';
import {
  generateNcltList,
  generateNcltScenario,
  NCLT_SCENARIO_RECIPES,
  randomNcltRecipe,
  type NcltTruthRow,
} from './synthetic/generate.ts';

const parse = (layout: LayoutDocument, config = NCLT_CONFIG) => parseNcltCauseList(layout, config);
const truthOf = (row: NcltCauseList['rows'][number]): NcltTruthRow =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== 'anchor' && key !== 'advocates'),
  ) as NcltTruthRow;
/** The value, or a test failure when it is missing. */
function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}
const rowsOf = (parsed: NcltCauseList): NcltTruthRow[] => parsed.rows.map(truthOf);

describe('header detection', () => {
  it('finds the header by synonyms, records absent columns and skips repeated headers', async () => {
    const standard = parse((await generateNcltScenario('standard-10-row')).layout);
    expect(standard.diagnostics).toMatchObject({
      headerFound: true,
      missingColumns: [],
      extraColumns: [],
    });

    const noCounsel = parse((await generateNcltScenario('no-counsel-columns')).layout);
    expect(noCounsel.diagnostics.missingColumns).toEqual([
      'counselPetitioner',
      'counselRespondent',
    ]);

    const multi = await generateNcltScenario('multi-page-repeated-headers');
    expect(multi.layout.pages.length).toBeGreaterThanOrEqual(3);
    const parsed = parse(multi.layout);
    expect(rowsOf(parsed)).toEqual(multi.truth.rows);
    expect(parsed.unparsedRows).toEqual([]);
    for (const row of parsed.rows) expect(row.anchor.quote).not.toMatch(/Sl\.? No/i);
  });

  it('tolerates reordered columns and other header spellings', async () => {
    const columns = [...NCLT_COLUMN_KEYS].reverse();
    const list = await generateNcltList({ seed: 77, rows: 8, columns, headers: 'varied' });
    // Reversed, Sl. No. is no longer the first column, so rows open on their CP number.
    expect(rowsOf(parse(list.layout))).toEqual(list.truth.rows);
  });

  it('needs at least minHeaderMatches known columns', async () => {
    const list = await generateNcltList({
      seed: 78,
      rows: 3,
      columns: ['slNo', 'cpNo', 'purpose', 'remarks'],
    });
    const parsed = parse(list.layout);
    expect(parsed.diagnostics.headerFound).toBe(false);
    expect(parsed.rows).toEqual([]);
    const lenient = defineAdapterConfig({
      ...NCLT_CONFIG,
      table: { ...must(NCLT_CONFIG.table), minHeaderMatches: 4 },
    });
    expect(parse(list.layout, lenient).rows).toHaveLength(3);
  });
});

describe('column clustering', () => {
  it('uses the configured tolerance: ±3 pt jitter parses at the default 6 pt, not at 0', async () => {
    const list = await generateNcltList({ ...NCLT_SCENARIO_RECIPES['jittered-columns'], seed: 91 });
    expect(rowsOf(parse(list.layout))).toEqual(list.truth.rows);
    const strict = defineAdapterConfig({
      ...NCLT_CONFIG,
      table: { ...must(NCLT_CONFIG.table), columnTolerancePx: 0 },
    });
    expect(NCLT_CONFIG.table?.columnTolerancePx).toBe(6);
    expect(rowsOf(parse(list.layout, strict))).not.toEqual(list.truth.rows);
  });

  it('joins multi-line cells in reading order', async () => {
    const list = await generateNcltScenario('wrapped-cells');
    const parsed = parse(list.layout);
    expect(rowsOf(parsed)).toEqual(list.truth.rows);
    expect(parsed.rows[0]?.petitioner).toMatch(
      /\(formerly Pretend Holdings Private Limited, FICTIONAL\)$/,
    );
  });
});

describe('row fields and case numbers', () => {
  it('parses CP(IB) No. 132/BB/2022 and application numbers', () => {
    expect(parseNcltCaseNumber('CP(IB) No. 132/BB/2022')).toEqual({
      prefix: 'CP(IB)',
      code: 'CPIB',
      number: '132',
      bench: 'BB',
      year: 2022,
    });
    expect(parseNcltCaseNumber('IA No. 275/2021')).toMatchObject({
      code: 'IA',
      number: '275',
      bench: null,
      year: 2021,
    });
    expect(parseNcltCaseNumbers('IA No. 275/21, 276/21\nCA 12/BB/2023')).toEqual([
      { prefix: 'IA', code: 'IA', number: '275', bench: null, year: 2021 },
      { prefix: 'IA', code: 'IA', number: '276', bench: null, year: 2021 },
      { prefix: 'CA', code: 'CA', number: '12', bench: 'BB', year: 2023 },
    ]);
    expect(parseNcltCaseNumber('No. 12/2023')).toBeNull();
  });

  it('parses every configured prefix the same way', () => {
    for (const { prefix, code } of NCLT_PREFIXES) {
      expect(parseNcltCaseNumber(`${prefix} No. 007/BB/2024`), prefix).toEqual({
        prefix,
        code,
        number: '7',
        bench: 'BB',
        year: 2024,
      });
    }
  });

  it('reads every column of a row and splits parties on Vs / V/s', async () => {
    const list = await generateNcltScenario('cpib-irp-rp');
    const parsed = parse(list.layout);
    expect(rowsOf(parsed)).toEqual(list.truth.rows);
    const row = parsed.rows[0];
    expect(row).toMatchObject({ slNo: '1', cp: { prefix: 'CP(IB)', bench: 'BB' } });
    expect(row?.resolutionProfessional).toBeTruthy();
    expect(row?.petitioner).not.toBeNull();
    expect(`${row?.petitioner ?? ''} ${row?.respondent ?? ''}`).not.toMatch(/\bV(?:s|\/s)\b/);
    const splitOn = new Set(parsed.rows.map((r) => /\b(V\/s|Vs\.?)\s/.exec(r.parties ?? '')?.[1]));
    expect(splitOn.size).toBeGreaterThan(1);
  });

  it('parses the unusual prefixes and children (TCP, CP(CAA), IA(Plan), MA, CA(CAA))', async () => {
    const list = await generateNcltScenario('unusual-prefix');
    const parsed = parse(list.layout);
    expect(rowsOf(parsed)).toEqual(list.truth.rows);
    expect(new Set(parsed.rows.map((row) => row.cp.prefix)).size).toBeGreaterThan(1);
    expect(parsed.diagnostics.unknownPrefixes).toEqual([]);
  });
});

describe('nested IAs', () => {
  it('attaches 4 IA rows to one CP: one parent, 4 children, anchored on the parent row', async () => {
    const list = await generateNcltScenario('nested-ias');
    const parsed = parse(list.layout);
    expect(rowsOf(parsed)).toEqual(list.truth.rows);
    const parent = parsed.rows[1];
    expect(parent?.children).toHaveLength(4);
    for (const child of parent?.children ?? []) {
      expect(child.kind).toBe('IA');
      expect(child.purpose).toBeTruthy();
      expect(child.section).toBeTruthy();
    }
    expect(parent?.anchor.quote.startsWith(`2 ${parent.cp.prefix} No. ${parent.cp.number}/`)).toBe(
      true,
    );
    for (const child of parent?.children ?? []) {
      expect(parent?.anchor.quote).not.toContain(`No. ${child.number}/`);
    }
  });

  it('reads several IAs in one cell, comma- or newline-separated, without purposes of their own', async () => {
    const lists = await Promise.all(
      [11, 12, 13, 14].map((seed) => generateNcltList({ seed, rows: 12, inlineIaRate: 1 })),
    );
    let multiple = 0;
    for (const list of lists) {
      const parsed = parse(list.layout);
      expect(rowsOf(parsed)).toEqual(list.truth.rows);
      multiple += parsed.rows.filter((row) => row.children.length === 2).length;
    }
    expect(multiple).toBeGreaterThan(0);
  });
});

describe('coram and hearing metadata', () => {
  it('reads the coram, physical hearing and 2:30 pm', async () => {
    const parsed = parse((await generateNcltScenario('standard-10-row')).layout);
    expect(parsed.listDate).toBe('2026-10-21');
    expect(parsed.bench).toMatch(/^Hon'ble .*Member \(Judicial\); Hon'ble .*Member \(Technical\)$/);
    expect(parsed).toMatchObject({ hearingMode: 'physical', hasVcLink: false });
    expect(parsed.benches[0]?.time).toBe('14:30');
  });

  it('records a video-conference link as a boolean and never stores the URL', async () => {
    const list = await generateNcltScenario('vc-notice');
    expect(list.layout.pages[0]?.text).toContain('https://example.invalid/');
    const parsed = parse(list.layout);
    expect(parsed).toMatchObject({ hearingMode: 'video_conference', hasVcLink: true });
    expect(parsed.benches).toEqual(list.truth.benches);
    const serialised = JSON.stringify([
      parsed,
      await createNcltAdapter().parseCauseList({
        kind: 'layout',
        layout: list.layout,
        meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: 'in.nclt.bengaluru' },
      }),
    ]);
    expect(serialised).not.toMatch(/https?:|example\.invalid|www\./);
  });

  it('starts a bench section per coram', async () => {
    const list = await generateNcltScenario('two-coram-sections');
    const parsed = parse(list.layout);
    expect(parsed.benches).toEqual(list.truth.benches);
    expect(parsed.benches).toHaveLength(2);
    expect(rowsOf(parsed)).toEqual(list.truth.rows);
    expect(parsed.rows.map((row) => row.benchIndex)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  });
});

describe('counsel', () => {
  it('keeps counsel names raw with alias spellings, as advocates[]', async () => {
    expect(counselAliases('Mr. K. S. Madeup')).toEqual(['K S MADEUP', 'MADEUP K S', 'KS MADEUP']);
    expect(counselAliases('Ms. Pretend Iyer')).toEqual(['PRETEND IYER']);
    const parsed = parse((await generateNcltScenario('standard-10-row')).layout);
    const row = parsed.rows[0];
    expect(row?.advocates.map((a) => a.raw)).toEqual([
      ...(row?.counselPetitioner ?? []),
      ...(row?.counselRespondent ?? []),
    ]);
    expect(row?.advocates.every((a) => a.aliases.length > 0)).toBe(true);
    const adapterRow = (
      await createNcltAdapter().parseCauseList({
        kind: 'layout',
        layout: (await generateNcltScenario('standard-10-row')).layout,
        meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: 'in.nclt.bengaluru' },
      })
    ).rows[0];
    expect(adapterRow?.advocates).toEqual(row?.advocates);
  });

  it('parses a list without counsel columns with a diagnostic', async () => {
    const list = await generateNcltScenario('no-counsel-columns');
    const parsed = parse(list.layout);
    expect(parsed.diagnostics.noCounselColumns).toBe(true);
    expect(rowsOf(parsed)).toEqual(list.truth.rows);
    expect(parsed.rows.every((row) => row.advocates.length === 0)).toBe(true);
  });
});

describe('anchors and unparsed rows', () => {
  it('anchors every row on consecutive page words, verbatim, with a bbox', async () => {
    for (const scenario of ['standard-10-row', 'nested-ias', 'two-coram-sections'] as const) {
      const { layout } = await generateNcltScenario(scenario);
      const parsed = parse(layout);
      parsed.rows.forEach((row, index) => {
        const page = layout.pages[row.anchor.page - 1];
        const words = (page?.words ?? []).map((word) => word.text);
        const quoteWords = row.anchor.quote.split(' ');
        const found = words.some((_, start) =>
          quoteWords.every((word, offset) => words[start + offset] === word),
        );
        expect(found, row.anchor.quote).toBe(true);
        expect(page?.text).toContain(row.anchor.quote);
        expect(row.anchor.rowIndex).toBe(index);
        expect(row.anchor.bbox).toBeDefined();
      });
    }
  });

  it('reports a line whose words run across columns in unparsedRows, with its anchor', async () => {
    const { layout } = await generateNcltScenario('standard-10-row');
    const page = must(layout.pages[0]);
    const pageWords = must(page.words);
    // A note printed across the Purpose and Section columns, below the last row.
    const y = Math.max(...pageWords.map((w) => w.bbox.y)) + 20;
    const purposeX = must(pageWords.find((w) => w.text === 'Purpose')).bbox.x;
    const note = 'Fictional overflowing note across columns';
    const words = note.split(' ').map((text, i) => ({
      text,
      bbox: { x: purposeX + i * 30, y, width: 60, height: 7 },
    }));
    const altered: LayoutDocument = {
      pages: [{ ...page, text: `${page.text}\n${note}`, words: [...pageWords, ...words] }],
    };
    const parsed = parse(altered);
    expect(parsed.rows).toHaveLength(10);
    expect(parsed.unparsedRows).toEqual([
      {
        reason: 'unassigned_words',
        anchor: expect.objectContaining({ page: 1, quote: note, rowIndex: 0 }) as unknown,
      },
    ]);
  });
});

describe('image-only PDFs', () => {
  it('returns needs_ocr for a PDF without a text layer, and parses the OCR layout of the same list', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([842, 595]);
    const scanned = await layoutFromPdf(await doc.save());
    expect(scanned.pages[0]?.textCoverage).toBe(0);
    const parsed = parse(scanned);
    expect(parsed).toMatchObject({ status: 'needs_ocr', rows: [], unparsedRows: [] });
    const adapterResult = await createNcltAdapter().parseCauseList({
      kind: 'layout',
      layout: scanned,
      meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: 'in.nclt.bengaluru' },
    });
    expect(adapterResult).toMatchObject({ status: 'needs_ocr', rows: [] });

    // OCR (#45) yields a layout with words and no coverage figure; the same parser reads it.
    const list = await generateNcltScenario('standard-10-row');
    const ocr: LayoutDocument = {
      pages: list.layout.pages.map((page) => ({
        page: page.page,
        width: page.width,
        height: page.height,
        text: page.text,
        items: page.items,
        ...(page.words === undefined ? {} : { words: page.words }),
      })),
    };
    expect(parse(ocr)).toMatchObject({ status: 'parsed' });
    expect(rowsOf(parse(ocr))).toEqual(list.truth.rows);
  });
});

describe('access modes', () => {
  it('declares user_supplied for lists and orders and none for status and display board', () => {
    expect(NCLT_ACCESS_MODES).toEqual({
      cause_list: 'user_supplied',
      orders: 'user_supplied',
      status: 'none',
      display_board: 'none',
    });
    expect(createNcltAdapter().accessModes).toEqual(NCLT_ACCESS_MODES);
    expect(createNcltAdapter().id).toBe('in.nclt.bengaluru');
  });
});

describe('performance and determinism', () => {
  it('parses a 30-page list in under 400 ms and gives identical JSON for the same input', async () => {
    const list = await generateNcltList({ ...randomNcltRecipe(30), rows: 270, sections: [270] });
    expect(list.layout.pages.length).toBeGreaterThanOrEqual(30);
    const first = JSON.stringify(parse(list.layout));
    // The fastest of 7 timed parses (after the warm-up above) is the parser's own cost. A median
    // still counts GC and scheduler stalls from other suites on a shared, coverage-instrumented
    // CI runner, which is what a wall-clock gate must not measure.
    const timings: number[] = [];
    for (let run = 0; run < 7; run += 1) {
      const start = performance.now();
      const again = JSON.stringify(parse(list.layout));
      timings.push(performance.now() - start);
      expect(again).toBe(first);
    }
    expect(Math.min(...timings)).toBeLessThan(400);
  });
});
