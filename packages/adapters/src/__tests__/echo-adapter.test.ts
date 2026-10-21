// The echo adapter proves the framework (#369): anchored rows with verbatim quotes, open-enum
// stages, diagnostics, byte-identical output for the same input and a 40-page list under 500 ms.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ECHO_FORUM_CODE,
  createEchoAdapter,
  ParsedCauseListSchema,
  ParsedOrderHeaderSchema,
  type ParserInput,
} from '../index.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../example/fixtures');

interface Manifest {
  classification: string;
  fixtures: { file: string; kind: string; classification: string }[];
}
const manifest = JSON.parse(readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8')) as Manifest;

const textInput = (text: string): ParserInput => ({
  kind: 'text',
  text,
  meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: ECHO_FORUM_CODE },
});
const fixture = (file: string) => readFileSync(path.join(FIXTURES, file), 'utf8');
const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Deterministic PRNG for the synthetic 40-page list. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticList(pages: number, rowsPerPage: number, seed: number): string {
  const random = mulberry32(seed);
  const types = ['W.P.', 'W.P.(MD)', 'Crl.O.P.', 'CRL OP', 'Arb.O.P.', 'W.A.', 'C.M.A.'];
  const stages = ['FOR ADMISSION', 'FOR ORDERS', 'FOR FINAL HEARING'];
  const out: string[] = [];
  let item = 0;
  for (let page = 0; page < pages; page += 1) {
    const lines = page === 0 ? ['ECHO TEST COURT (FICTIONAL)', 'CAUSE LIST FOR 21.10.2026'] : [];
    lines.push(`COURT HALL ${String(page + 1)}`, stages[page % stages.length] ?? 'FOR ORDERS');
    for (let row = 0; row < rowsPerPage; row += 1) {
      item += 1;
      const type = types[Math.floor(random() * types.length)] ?? 'W.P.';
      const number = String(Math.floor(random() * 99_999) + 1);
      lines.push(
        `${String(item)}. ${type} No. ${number} of 2026  Fictional Party ${String(item)} vs Pretend Respondent`,
      );
    }
    out.push(lines.join('\n'));
  }
  return out.join('\f');
}

describe('echo fixtures', () => {
  it('ships three fictional lists, all flagged FICTIONAL', () => {
    expect(manifest.classification).toBe('FICTIONAL');
    expect(manifest.fixtures).toHaveLength(3);
    for (const entry of manifest.fixtures) expect(entry.classification).toBe('FICTIONAL');
  });
});

describe('echo adapter parseCauseList', () => {
  const adapter = createEchoAdapter();

  it.each(manifest.fixtures.map((f) => f.file))(
    '%s: every row is anchored with a quote found verbatim in its page text',
    async (file) => {
      const text = fixture(file);
      const pages = text.split('\f');
      const parsed = ParsedCauseListSchema.parse(await adapter.parseCauseList(textInput(text)));
      expect(parsed.rows.length).toBeGreaterThan(0);
      parsed.rows.forEach((row, index) => {
        expect(row.anchor.rowIndex).toBe(index);
        expect(pages[row.anchor.page - 1]).toContain(row.anchor.quote);
        expect(row.confidence).toBeGreaterThanOrEqual(0);
        expect(row.confidence).toBeLessThanOrEqual(1);
      });
    },
  );

  it('reads hall, stage, case identity and the list date', async () => {
    const parsed = await adapter.parseCauseList(textInput(fixture('list-01-admission.txt')));
    expect(parsed.listDate).toBe('2026-10-21');
    expect(parsed.rows.map((r) => [r.hallNo, r.stageNorm, r.matchKey])).toEqual([
      ['1', 'admission', 'WP/12345/2026'],
      ['1', 'admission', 'WP(MD)/42/2026'],
      ['1', 'orders', 'CRLOP/77/2026'],
    ]);
    expect(parsed.rows[1]).toMatchObject({
      seatSuffix: 'MD',
      parties: 'Meera Solai vs Imaginary Town Panchayat',
    });
    expect(parsed.diagnostics).toEqual({
      unmappedHeadings: [],
      unknownCaseTypes: [],
      rowsSkippedNoAnchor: 0,
      hallsSeen: ['1'],
      hallsUnreadable: [],
    });
  });

  it('keeps unknown headings verbatim, counts them, and reports unknown types and empty halls', async () => {
    const parsed = await adapter.parseCauseList(textInput(fixture('list-02-multi-page.txt')));
    const sitting = parsed.rows.filter((r) => r.hallNo === '3');
    expect(sitting.map((r) => [r.stageRaw, r.stageNorm])).toEqual([
      ['AFTER LUNCH SPECIAL SITTING', null],
      ['AFTER LUNCH SPECIAL SITTING', null],
    ]);
    expect(parsed.diagnostics.unmappedHeadings).toEqual(['AFTER LUNCH SPECIAL SITTING']);
    expect(parsed.diagnostics.unknownCaseTypes).toEqual(['Z.Q.R.']);
    expect(parsed.diagnostics.hallsSeen).toEqual(['2', '3', '4']);
    expect(parsed.diagnostics.hallsUnreadable).toEqual(['4']);
    expect(parsed.rows.find((r) => r.hallNo === '3')?.anchor.page).toBe(2);
    expect(parsed.listDate).toBe('2026-10-22');
  });

  it('maps adapter aliases', async () => {
    const parsed = await adapter.parseCauseList(
      textInput(fixture('list-03-alias-and-mentions.txt')),
    );
    expect(parsed.rows.map((r) => [r.caseType, r.stageNorm])).toEqual([
      ['WP', 'mention'],
      ['WP', 'mention'],
    ]);
  });

  it('never emits a row whose quote is not on its page', async () => {
    const input: ParserInput = {
      kind: 'layout',
      layout: {
        pages: [
          {
            page: 1,
            width: 595,
            height: 842,
            // The anchored row is quoted from `text`; its bbox comes from the matching item.
            text: 'COURT HALL 1\nFOR ADMISSION\n1. W.P. 1/2026  A vs B',
            items: [
              { text: '1. W.P. 1/2026  A vs B', bbox: { x: 10, y: 20, width: 300, height: 12 } },
            ],
          },
        ],
      },
      meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: ECHO_FORUM_CODE },
    };
    const parsed = await adapter.parseCauseList(input);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.anchor).toEqual({
      page: 1,
      quote: '1. W.P. 1/2026  A vs B',
      rowIndex: 0,
      bbox: { x: 10, y: 20, width: 300, height: 12 },
    });
    expect(await adapter.parseCauseList(textInput(''))).toMatchObject({ rows: [] });
  });

  it('is deterministic: the same input gives byte-identical JSON', async () => {
    for (const { file } of manifest.fixtures) {
      const input = textInput(fixture(file));
      const first = await createEchoAdapter().parseCauseList(input);
      const second = await createEchoAdapter().parseCauseList(structuredClone(input));
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(sha256(second)).toBe(sha256(first));
    }
    const other = await adapter.parseCauseList({
      ...textInput(fixture('list-01-admission.txt')),
      meta: { receivedAt: '2027-01-01T00:00:00.000Z', forumCode: ECHO_FORUM_CODE },
    });
    expect(sha256(other)).toBe(
      sha256(await adapter.parseCauseList(textInput(fixture('list-01-admission.txt')))),
    );
  });

  it('parses a 40-page list in under 500 ms', async () => {
    const text = syntheticList(40, 50, 369);
    expect(syntheticList(40, 50, 369)).toBe(text);
    const input = textInput(text);
    await adapter.parseCauseList(input);
    const started = performance.now();
    const parsed = await adapter.parseCauseList(input);
    const elapsed = performance.now() - started;
    expect(parsed.rows).toHaveLength(2000);
    expect(parsed.diagnostics.rowsSkippedNoAnchor).toBe(0);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('echo adapter orders and links', () => {
  const order = [
    'IN THE ECHO TEST COURT (FICTIONAL)',
    'W.P.(MD) No. 0042 of 2026',
    'Dated: 05.10.2026',
    'Neutral Citation: 2026:MHC:01234',
    'Heard the counsel. The respondent is directed to file a counter. List after two weeks.',
  ].join('\n');

  it('reads the order header', () => {
    const header = ParsedOrderHeaderSchema.parse(
      createEchoAdapter().parseOrderHeader(textInput(order)),
    );
    expect(header).toMatchObject({
      caseType: 'WP',
      seatSuffix: 'MD',
      caseNumber: '42',
      caseYear: 2026,
      orderDate: '2026-10-05',
      neutralCitation: '2026:MHC:1234',
      confidence: 1,
      anchor: { page: 1, quote: 'W.P.(MD) No. 0042 of 2026', rowIndex: 0 },
    });
  });

  it('finds anchored direction cues', () => {
    const cues = createEchoAdapter().findDirectionCues(textInput(order));
    expect(cues.map((c) => c.text)).toEqual([
      'The respondent is directed to file a counter.',
      'List after two weeks.',
    ]);
    for (const cue of cues) expect(order).toContain(cue.anchor.quote);
  });

  it('builds deep links only through the injected resolver', () => {
    expect(createEchoAdapter().buildDeepLink('cause_list', {})).toBeNull();
    const link = {
      url: 'https://echo.example/list',
      fallbacks: [],
      target: '_blank' as const,
      rel: 'noopener noreferrer' as const,
    };
    const adapter = createEchoAdapter({
      resolveDeepLink: (kind) => (kind === 'cause_list' ? link : null),
    });
    expect(adapter.buildDeepLink('cause_list', {})).toEqual(link);
    expect(adapter.buildDeepLink('status', {})).toBeNull();
  });
});
