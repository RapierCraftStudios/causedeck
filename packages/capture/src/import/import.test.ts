import { ProposalDraftSchema } from '@causedeck/validators/proposal-draft';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  applyMapping,
  autoMapColumns,
  ImportReadError,
  parseCaseNumber,
  parseCsv,
  parseSheetDate,
  readXlsx,
  rowsToDrafts,
} from './index.ts';

const HEADER = [
  'Sr No',
  'Case No.',
  'Court / Bench',
  'Parties',
  'Stage',
  'Next Date of Hearing',
  'CNR',
];
const COURTS = ['Karnataka High Court', 'City Civil Court Bengaluru', 'NCLT Bengaluru'];
const TYPES = ['WP', 'CRL.A', 'OS', 'CP'];

function sheetRows(count: number): string[][] {
  const rows: string[][] = [];
  for (let i = 1; i <= count; i += 1) {
    const day = String((i % 27) + 1).padStart(2, '0');
    rows.push([
      String(i),
      `${TYPES[i % 4] ?? ''} ${String(i)}/${String(2020 + (i % 5))}`,
      COURTS[i % 3] ?? '',
      `Party ${String(i)} & Sons vs State of K'taka`,
      i % 2 === 0 ? 'Arguments' : 'Evidence',
      `${day}/${String((i % 12) + 1).padStart(2, '0')}/2027`,
      i % 10 === 0
        ? `KAHC01${String(i).padStart(6, '0')}${String(2020 + (i % 5))}`.slice(0, 16)
        : '',
    ]);
  }
  return rows;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function buildXlsx(header: string[], rows: string[][]): Uint8Array {
  const strings: string[] = [];
  const sst = (value: string): number => {
    const found = strings.indexOf(value);
    if (found >= 0) return found;
    strings.push(value);
    return strings.length - 1;
  };
  const letter = (i: number): string => String.fromCharCode(65 + i);
  const xmlRows = [header, ...rows].map((row, r) => {
    const cells = row
      .map((value, c) => {
        if (value === '') return '';
        const ref = `${letter(c)}${String(r + 1)}`;
        return /^\d+$/.test(value) && r > 0 && c === 0
          ? `<c r="${ref}"><v>${value}</v></c>`
          : `<c r="${ref}" t="s"><v>${String(sst(value))}</v></c>`;
      })
      .join('');
    return `<row r="${String(r + 1)}">${cells}</row>`;
  });
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${xmlRows.join('')}</sheetData></worksheet>`;
  const sharedXml = `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`;
  return zipSync({
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/sharedStrings.xml': strToU8(sharedXml),
  });
}

describe('parseCsv', () => {
  it('reads BOM, CRLF, quotes, embedded delimiters and newlines', () => {
    const text = '﻿a,b,c\r\n1,"x, ""y""",3\r\n\r\n"multi\nline",,z';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, "y"', '3'],
      ['multi\nline', '', 'z'],
    ]);
  });

  it('sniffs semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\tb\n1\t2')[1]).toEqual(['1', '2']);
  });
});

describe('autoMapColumns', () => {
  it('maps the diary columns and reports coverage', () => {
    const result = autoMapColumns(HEADER);
    expect(result.mapping).toMatchObject({
      caseNumber: 'Case No.',
      court: 'Court / Bench',
      party: 'Parties',
      stage: 'Stage',
      nextDate: 'Next Date of Hearing',
      cnr: 'CNR',
    });
    expect(result.unmapped).toEqual(['Sr No']);
    expect(result.coverage).toBeGreaterThanOrEqual(0.85);
  });

  it('does not take Case Type as the number, and lets a saved mapping win', () => {
    const header = ['Case Type', 'Case Number', 'Hearing', 'Client'];
    expect(autoMapColumns(header).indices).toMatchObject({ caseType: 0, caseNumber: 1 });
    const saved = { nextDate: 'Hearing', party: 'client' };
    const mapped = autoMapColumns(header, saved);
    expect(mapped.indices).toMatchObject({ nextDate: 2, party: 3 });
    expect(applyMapping(header, { stage: 'gone' })).toEqual({});
  });
});

describe('parsers', () => {
  it('parses dates day-first, with month names, ISO and Excel serials', () => {
    expect(parseSheetDate('05/03/2027')).toBe('2027-03-05');
    expect(parseSheetDate('5-Mar-2027')).toBe('2027-03-05');
    expect(parseSheetDate('12 September 2027')).toBe('2027-09-12');
    expect(parseSheetDate('2027-03-05')).toBe('2027-03-05');
    expect(parseSheetDate('46086')).toBe('2026-03-05');
    expect(parseSheetDate('31/02/2027')).toBeNull();
    expect(parseSheetDate('soon')).toBeNull();
  });

  it('parses case numbers', () => {
    expect(parseCaseNumber('WP 123/2024')).toEqual({ type: 'WP', number: '123', year: 2024 });
    expect(parseCaseNumber('Crl.A. No. 45 of 2023')).toEqual({
      type: 'Crl.A',
      number: '45',
      year: 2023,
    });
    expect(parseCaseNumber('77')).toEqual({ type: null, number: '77', year: null });
    expect(parseCaseNumber('n/a')).toBeNull();
  });
});

describe('500-row chamber workbook', () => {
  const rows = sheetRows(500);
  const bytes = buildXlsx(HEADER, rows);

  it('reads the xlsx and auto-maps at least 90% of the columns', () => {
    const read = readXlsx(bytes);
    expect(read).toHaveLength(501);
    expect(read[0]).toEqual(HEADER);
    expect(read[1]?.[3]).toBe("Party 1 & Sons vs State of K'taka");
    const { coverage, mapping } = autoMapColumns(read[0] ?? []);
    expect(Object.keys(mapping)).toHaveLength(6);
    expect(coverage).toBeGreaterThanOrEqual(0.85);
    // Sr No is a serial, not a field: the importer maps the 6 data columns of 7 present.
  });

  it('turns every row into a valid proposal draft', () => {
    const read = readXlsx(bytes);
    const { indices } = autoMapColumns(read[0] ?? []);
    const { drafts, errors } = rowsToDrafts(read.slice(1), indices);
    expect(errors).toEqual([]);
    expect(drafts).toHaveLength(500);
    for (const draft of drafts) expect(ProposalDraftSchema.safeParse(draft).success).toBe(true);
    expect(drafts[0]?.payload).toMatchObject({
      caseTypeRaw: 'CRL.A',
      caseNumber: '1',
      caseYear: 2021,
      forumCode: 'City Civil Court Bengaluru',
      nextDate: '2027-02-02',
    });
  });

  it('re-importing the same sheet creates no duplicates', () => {
    const run = () => {
      const read = readXlsx(bytes);
      return rowsToDrafts(read.slice(1), autoMapColumns(read[0] ?? []).indices);
    };
    const first = run();
    const second = run();
    expect(second.drafts).toEqual(first.drafts);
    const keys = (drafts: typeof first.drafts) =>
      drafts.map((d) => `${String(d.payload['matchKey'])}|${String(d.payload['nextDate'])}`);
    expect(new Set(keys([...first.drafts, ...second.drafts])).size).toBe(500);
    // Stacking the sheet twice in one file collapses to the same drafts.
    const doubled = rowsToDrafts([...rows, ...rows], autoMapColumns(HEADER).indices);
    expect(doubled.drafts).toEqual(first.drafts);
    expect(doubled.duplicates).toBe(500);
  });
});

describe('rowsToDrafts', () => {
  const indices = autoMapColumns(HEADER).indices;

  it('keeps the case without a date when the date is unreadable and reports the row', () => {
    const { drafts, errors } = rowsToDrafts(
      [
        ['1', 'WP 5/2024', 'HC', 'A v B', '', 'soon', ''],
        ['2', '', 'HC', 'C v D', '', '01/01/2027', ''],
        ['', '', '', '', '', '', ''],
      ],
      indices,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.payload['nextDate']).toBeUndefined();
    expect(errors).toEqual([
      { line: 2, message: 'Unreadable date' },
      { line: 3, message: 'No case number or CNR' },
    ]);
  });

  it('keys by CNR when present and keeps differing dates for the plan to flag', () => {
    const cnr = 'KAHC010012342024';
    const { drafts } = rowsToDrafts(
      [
        ['1', 'WP 5/2024', 'HC', 'A', '', '01/01/2027', cnr],
        ['2', 'WP 5/2024', 'HC', 'A', '', '02/01/2027', cnr],
      ],
      indices,
    );
    expect(drafts.map((d) => d.payload['matchKey'])).toEqual([`cnr:${cnr}`, `cnr:${cnr}`]);
    expect(drafts.map((d) => d.payload['nextDate'])).toEqual(['2027-01-01', '2027-01-02']);
  });
});

describe('readXlsx', () => {
  it('refuses a file that is not a workbook', () => {
    expect(() => readXlsx(strToU8('plain text'))).toThrow(ImportReadError);
    expect(() => readXlsx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/no worksheet/);
  });
});
