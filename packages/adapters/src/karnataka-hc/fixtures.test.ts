// The committed Karnataka HC fixtures (#408): 12 cause lists, 12 orders and 4 FR / scrutiny-objection
// notices, all synthetic and FICTIONAL, listed in manifest.json. Orders and notices parse to their
// expected files with every anchor quote verbatim on its line; the cause lists are scored by the
// golden runner (src/__tests__/golden.test.ts), and their named edge cases are checked here. Runs in
// `test:golden` (vitest.golden.config.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { layoutFromHtml } from '../layout/html.ts';
import { layoutFromPdf } from '../layout/pdf.ts';
import { FIXTURES_ROOT, FixtureManifestSchema, GOLDEN_RECEIVED_AT } from '../testing/golden.ts';
import {
  DirectionCueSchema,
  ParsedCauseListSchema,
  ParsedOrderHeaderSchema,
  RegistryEventSchema,
  type Anchor,
  type ParsedCauseList,
  type ParserInput,
} from '../types.ts';

import {
  createKarnatakaHcAdapter,
  KARNATAKA_HC_ADAPTER_ID,
  parseKarnatakaRegistryEvents,
} from './index.ts';

const dir = path.join(FIXTURES_ROOT, KARNATAKA_HC_ADAPTER_ID);
const manifest = FixtureManifestSchema.parse(
  JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
);
const adapter = createKarnatakaHcAdapter();
const lists = manifest.fixtures.filter((entry) => entry.kind === 'cause_list');
const orders = manifest.fixtures.filter((entry) => entry.kind === 'order');
const notices = manifest.fixtures.filter((entry) => entry.kind === 'registry_notice');
const meta = (file: string) => ({
  fileName: file,
  receivedAt: GOLDEN_RECEIVED_AT,
  forumCode: adapter.forumCodes[0] ?? '',
});

function textInput(file: string): ParserInput {
  return { kind: 'text', text: readFileSync(path.join(dir, file), 'utf8'), meta: meta(file) };
}

async function list(name: string): Promise<ParsedCauseList> {
  const file = lists.find((entry) => entry.file.startsWith(`${name}.input.`))?.file ?? '';
  const input: ParserInput = file.endsWith('.pdf')
    ? {
        kind: 'layout',
        layout: await layoutFromPdf(new Uint8Array(readFileSync(path.join(dir, file)))),
        meta: meta(file),
      }
    : (() => {
        const html = readFileSync(path.join(dir, file), 'utf8');
        return { kind: 'html', html, layout: layoutFromHtml(html), meta: meta(file) };
      })();
  return ParsedCauseListSchema.parse(await adapter.parseCauseList(input));
}

const expectedOf = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(dir, file.replace(/\.input\.txt$/, '.expected.json')), 'utf8'));

function expectVerbatim(input: ParserInput, anchors: readonly Anchor[], file: string) {
  const pages = (input.text ?? '').split('\f');
  for (const anchor of anchors) {
    const lines = (pages[anchor.page - 1] ?? '').split('\n');
    expect(lines[anchor.rowIndex], `${file}: ${anchor.quote}`).toContain(anchor.quote);
  }
}

describe('Karnataka HC committed fixtures', () => {
  it('commits 12 lists, 12 orders and 4 notices, synthetic and FICTIONAL', () => {
    expect(manifest.adapter).toBe(KARNATAKA_HC_ADAPTER_ID);
    expect(manifest.classification).toBe('FICTIONAL');
    expect(lists).toHaveLength(12);
    expect(orders).toHaveLength(12);
    expect(notices).toHaveLength(4);
    expect(lists.filter((entry) => entry.file.endsWith('.pdf'))).toHaveLength(1);
    for (const entry of manifest.fixtures) {
      expect(entry, entry.file).toMatchObject({ origin: 'synthetic', classification: 'FICTIONAL' });
      if (entry.file.endsWith('.pdf')) continue;
      expect(readFileSync(path.join(dir, entry.file), 'utf8'), entry.file).toContain('FICTIONAL');
    }
  });

  it.each(orders.map((entry) => entry.file))(
    '%s parses to its expected header and cues',
    (file) => {
      const input = textInput(file);
      const header = ParsedOrderHeaderSchema.parse(adapter.parseOrderHeader(input));
      const cues = adapter.findDirectionCues(input).map((cue) => DirectionCueSchema.parse(cue));
      expect({ header, cues }).toEqual(expectedOf(file));
      expectVerbatim(
        input,
        [...(header.anchor === null ? [] : [header.anchor]), ...cues.map((cue) => cue.anchor)],
        file,
      );
    },
  );

  it.each(notices.map((entry) => entry.file))('%s parses to its expected events', (file) => {
    const input = textInput(file);
    const events = parseKarnatakaRegistryEvents(input).map((event) =>
      RegistryEventSchema.parse(event),
    );
    expect({ events }).toEqual(expectedOf(file));
    expect(events.length, file).toBeGreaterThan(0);
    expectVerbatim(
      input,
      events.map((event) => event.anchor),
      file,
    );
  });
});

describe('Karnataka HC list fixtures: named cases', () => {
  it('reads three halls with two lists each from the daily Bengaluru page', async () => {
    const parsed = await list('list-01-daily-three-halls-two-lists');
    expect(parsed).toMatchObject({ status: 'ok', listType: 'daily', listDate: '2026-10-22' });
    expect(parsed.publishedAt).toBe('2026-10-21T18:30:00+05:30');
    expect(parsed.halls?.map((hall) => [hall.hallNo, hall.lists.map((l) => l.listNo)])).toEqual([
      ['1', ['1', '2']],
      ['2', ['1', '2']],
      ['3', ['1', '2']],
    ]);
  });

  it('reads the consolidated PDF across pages, keeping List 1 and 2 apart', async () => {
    const parsed = await list('list-02-consolidated');
    expect(parsed).toMatchObject({ status: 'ok', source: 'pdf', listType: 'daily' });
    expect(parsed.rows).toHaveLength(10);
    // Hall 2, List 1 continues on page 2 under its repeated hall heading.
    const continued = parsed.rows.find((row) => row.matchKey === 'CRLRP/812/2024');
    expect(continued).toMatchObject({ hallNo: '2', listNo: '1', stageNorm: 'admission' });
    expect(continued?.anchor.page).toBe(2);
    // Wrapped case and party lines join their row.
    expect(parsed.rows.find((row) => row.matchKey === 'RFA/100/2024')?.children).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      subCategory: 'GM-RES',
      parties: 'K. Kalpita Gowda vs State of Fictionland',
    });
  });

  it('sets advance and supplementary list types', async () => {
    expect((await list('list-03-advance')).listType).toBe('advance');
    const supplementary = await list('list-04-supplementary');
    expect(supplementary.listType).toBe('supplementary');
    expect(supplementary.rows.every((row) => row.listType === 'supplementary')).toBe(true);
  });

  it('keeps Dharwad-style 100xxx numbers opaque with the bench-numbering hint', async () => {
    const parsed = await list('list-05-dharwad-style-100xxx');
    expect(parsed.rows.map((row) => [row.caseNumber, row.benchNumbering])).toEqual([
      ['100512', '100xxx'],
      ['101137', '100xxx'],
      ['100044', '100xxx'],
    ]);
  });

  it('reads rows of a table without advocate columns', async () => {
    const parsed = await list('list-06-no-advocate-columns');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.every((row) => row.advocates?.length === 0)).toBe(true);
  });

  it('maps heading variants and keeps an unmapped heading verbatim', async () => {
    const parsed = await list('list-07-heading-variants');
    expect(parsed.rows.map((row) => row.stageNorm)).toEqual([
      'preliminary_hearing_b_group',
      'hearing_on_ia',
      'final_hearing',
      'judgment',
      null,
    ]);
    expect(parsed.diagnostics.unmappedHeadings).toEqual(['MOVED BY THE REGISTRY']);
  });

  it('flags every row under Orders (registry objections)', async () => {
    const parsed = await list('list-08-orders-registry-objections');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.every((row) => row.registryObjection === true)).toBe(true);
  });

  it('reads header cells and stage headings reflowed over two lines', async () => {
    const parsed = await list('list-09-reflowed-multiline-headings');
    expect(parsed.rows.map((row) => [row.stageRaw, row.stageNorm, row.parties])).toEqual([
      [
        'PRELIMINARY HEARING',
        'preliminary_hearing',
        'Example Coffee Estates vs State of Fictionland',
      ],
      ['FOR BEING SPOKEN TO', 'being_spoken_to', 'K. Kalpita Gowda vs Imaginary Panchayat'],
    ]);
  });

  it('repairs broken HTML and still reads every row', async () => {
    const parsed = await list('list-10-broken-html');
    expect(parsed.rows.map((row) => row.matchKey)).toEqual([
      'WP/4501/2026',
      'RFA/88/2024',
      'MFA/7001/2025',
    ]);
  });

  it('reads the sitting-list page as not a cause list, with zero rows', async () => {
    const parsed = await list('list-11-sitting-list-noise');
    expect(parsed.status).toBe('not_a_cause_list');
    expect(parsed.rows).toEqual([]);
    expect(parsed.unparsedRows).toEqual([]);
  });

  it('reads a list that prints no cases as empty', async () => {
    const parsed = await list('list-12-empty');
    expect(parsed).toMatchObject({ status: 'empty', rows: [], listDate: '2026-10-30' });
  });
});

describe('Karnataka HC order and notice fixtures: named cases', () => {
  const header = (name: string) => adapter.parseOrderHeader(textInput(`${name}.input.txt`));
  const cues = (name: string) => adapter.findDirectionCues(textInput(`${name}.input.txt`));

  it('reads the KHC, KHC-D and -DB neutral citations', () => {
    expect(header('order-01-final-khc-citation').neutralCitation).toBe('2026:KHC:1234');
    expect(header('order-02-final-khc-d-rsa')).toMatchObject({
      neutralCitation: '2026:KHC-D:567',
      caseType: 'RSA',
    });
    expect(header('order-03-final-db-writ-appeal')).toMatchObject({
      neutralCitation: '2026:KHC:89-DB',
      judges: ["THE HON'BLE THE CHIEF JUSTICE (FICTIONAL)", "THE HON'BLE MRS JUSTICE B. EXAMPLE"],
    });
  });

  it('leaves the relative date of an interim order unresolved', () => {
    expect(header('order-04-interim-relative-date').orderType).toBe('interim');
    const relative = cues('order-04-interim-relative-date').find(
      (cue) => cue.kind === 'next_date_relative',
    );
    expect(relative).toMatchObject({ date: null, text: 'List after two weeks.' });
  });

  it('reads an absolute call-on date and a reserved order', () => {
    expect(cues('order-05-absolute-call-on').map((cue) => [cue.kind, cue.date])).toEqual([
      ['next_date', '2026-11-12'],
    ]);
    expect(cues('order-06-reserved').map((cue) => cue.kind)).toEqual(['reserved']);
  });

  it('reads both cases of a common order', () => {
    expect(header('order-07-multi-case-common-order').caseRefs?.map((ref) => ref.matchKey)).toEqual(
      ['WP/7001/2026', 'WP/7002/2026'],
    );
  });

  it('never takes a decoy earlier-order date as the order date or a next date', () => {
    const input = textInput('order-08-decoy-earlier-order-date.input.txt');
    expect(input.text).toContain('impugned order dated 03.03.2019');
    expect(adapter.parseOrderHeader(input).orderDate).toBe('2026-10-27');
    expect(adapter.findDirectionCues(input).every((cue) => cue.date === null)).toBe(true);
  });

  it('emits no next date for an RFA order without one', () => {
    expect(header('order-09-no-next-date-rfa').caseType).toBe('RFA');
    expect(cues('order-09-no-next-date-rfa')).toEqual([]);
  });

  it('keeps the bracketed writ category', () => {
    expect(header('order-10-writ-category-in-brackets').caseRefs?.[0]).toMatchObject({
      subCategory: 'LB-RES',
      benchNumbering: '100xxx',
    });
  });

  it('reads the next date on page 22 of the long order', () => {
    const input = textInput('order-11-long-over-20-pages.input.txt');
    expect((input.text ?? '').split('\f').length).toBeGreaterThan(20);
    const cue = adapter.findDirectionCues(input).find((c) => c.kind === 'next_date');
    expect(cue?.date).toBe('2026-12-03');
    expect(cue?.anchor.page).toBe(22);
  });

  it('reads the compliance period of a scrutiny-objection order as time-bound', () => {
    expect(cues('order-12-scrutiny-objection-order').map((cue) => cue.kind)).toEqual([
      'time_bound',
    ]);
  });

  it('derives cure deadlines from the printed scrutiny and return dates', () => {
    const deadlines = ['registry-03-cure-deadline', 'registry-04-returned-re-present'].map(
      (name) =>
        parseKarnatakaRegistryEvents(textInput(`${name}.input.txt`)).find(
          (event) => event.kind === 'cure_deadline',
        )?.deadline,
    );
    expect(deadlines).toEqual([
      { n: 7, unit: 'days', basisDate: '2026-10-21', derived: '2026-10-28' },
      { n: 2, unit: 'weeks', basisDate: '2026-10-24', derived: '2026-11-07' },
    ]);
  });
});
