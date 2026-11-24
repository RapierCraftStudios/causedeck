import type { schema } from '@causedeck/db';
import { describe, expect, it } from 'vitest';

import { segmentJudgment } from '../segment.ts';

import {
  HF_ATTRIBUTION,
  HF_SOURCE_ID,
  hfJudgmentSha256,
  runHfImport,
  type HfCursor,
  type HfImportStore,
} from './import.ts';
import { inSlice, mapHfRow } from './map.ts';
import { normaliseText, qualityDrop, textHash } from './quality.ts';
import {
  createHfHttpSource,
  HfHttpError,
  type HfDatasetSource,
  type HfFetch,
  type HfParquetFile,
} from './reader.ts';

type JudgmentInsert = typeof schema.judgment.$inferInsert;

const BASE = 'https://huggingface.co/datasets/overthelex/indian-court-decisions/';

/** A readable judgment body of a few hundred characters, distinct per `n`. */
const body = (n: number, extra = ''): string =>
  `IN THE HIGH COURT OF KARNATAKA AT BENGALURU\nDated this ${String(n)} day of March 2021.\n${extra}` +
  `The appeal number ${String(n)} arises from an order of the trial court under Section 138 of the ` +
  `Negotiable Instruments Act. Learned counsel for the appellant submitted that the cheque was issued ` +
  `as security and not towards any debt. The respondent relied on the presumption in Section 139. ` +
  `Having heard both sides, the appeal is dismissed with costs of rupees ${String(n * 1000)} only.`;

/** In-memory `HfImportStore`. */
function memoryStore() {
  const judgments: (JudgmentInsert & { id: string })[] = [];
  const aliases: { cnr: string; judgmentId: string; sourceId: string }[] = [];
  const cursors = new Map<string, HfCursor & { archiveKey: string; rowsAdded: number }>();
  const store: HfImportStore = {
    cursor: ({ archiveKey }) => {
      let c = cursors.get(archiveKey);
      if (c === undefined) {
        c = {
          id: `c${String(cursors.size + 1)}`,
          position: 0,
          status: 'pending',
          archiveKey,
          rowsAdded: 0,
        };
        cursors.set(archiveKey, c);
      }
      return Promise.resolve({ id: c.id, position: c.position, status: c.status });
    },
    advance: (id, position, delta) => {
      const c = [...cursors.values()].find((x) => x.id === id);
      if (c !== undefined)
        Object.assign(c, { position, status: 'running', rowsAdded: c.rowsAdded + delta.added });
      return Promise.resolve();
    },
    complete: (id) => {
      const c = [...cursors.values()].find((x) => x.id === id);
      if (c !== undefined) c.status = 'complete';
      return Promise.resolve();
    },
    findByTextHash: (hash) => {
      const j = judgments.find((x) => x.textHash === hash);
      return Promise.resolve(j === undefined ? null : { id: j.id, cnr: j.cnr ?? null });
    },
    cnrKnown: (cnr) =>
      Promise.resolve(judgments.some((j) => j.cnr === cnr) || aliases.some((a) => a.cnr === cnr)),
    insertJudgment: (values) => {
      if (judgments.some((j) => j.sha256 === values.sha256)) return Promise.resolve(null);
      const id = `j${String(judgments.length + 1)}`;
      judgments.push({ ...values, id });
      return Promise.resolve(id);
    },
    addAlias: (alias) => {
      aliases.push(alias);
      return Promise.resolve();
    },
  };
  return { store, judgments, aliases, cursors };
}

type Row = Record<string, unknown>;

/** A dataset of one file with the given row groups; records every `readRows` range. */
function memorySource(groups: Row[][], reads: [number, number, readonly string[]][] = []) {
  const rows = groups.flat();
  const file: HfParquetFile = { path: 'high_courts/train-00000-of-00001.parquet', size: 1000 };
  let bytes = 0;
  const source: HfDatasetSource = {
    list: (config) => Promise.resolve(config === 'high_courts' ? [file] : []),
    open: () =>
      Promise.resolve({
        rowGroups: groups.map((g) => g.length),
        columns: Object.keys(rows[0] ?? {}),
        readRows: (start, end, columns) => {
          reads.push([start, end, columns]);
          bytes += 100 * (end - start);
          return Promise.resolve(
            rows
              .slice(start, end)
              .map((r) => Object.fromEntries(columns.filter((c) => c in r).map((c) => [c, r[c]]))),
          );
        },
      }),
    bytesRead: () => bytes,
  };
  return { source, reads };
}

const row = (n: number, over: Row = {}): Row => ({
  cnr: `KAHC01${String(n).padStart(6, '0')}2021`,
  court_code: 'KAHC',
  court_name: 'High Court of Karnataka',
  bench: null,
  year: 2021,
  decision_date: '2021-03-10',
  title: null,
  judge: "Hon'ble Mr. Justice Arvind Rao",
  case_type: 'RFA',
  full_text: body(n),
  ...over,
});

const request = { dataset: 'hc' as const, baseUrl: BASE };
const now = () => new Date('2026-11-24T00:00:00Z');

describe('runHfImport', () => {
  it('stores a text-only judgment pending its PDF, with source, CNR, licence and attribution', async () => {
    const db = memoryStore();
    const { source } = memorySource([[row(1)]]);
    const report = await runHfImport({ store: db.store, source, now }, request);
    expect(report).toMatchObject({
      files: 1,
      rows: 1,
      inserted: 1,
      duplicates: 0,
      budgetReached: false,
    });
    const [j] = db.judgments;
    const hash = textHash(body(1));
    expect(j).toMatchObject({
      sourceId: HF_SOURCE_ID,
      cnr: 'KAHC010000012021',
      textHash: hash,
      sha256: hfJudgmentSha256(hash),
      pinpointState: 'pending-pdf',
      licence: 'CC-BY-4.0',
      attribution: HF_ATTRIBUTION,
      court: 'High Court of Karnataka',
      judgmentDate: '2021-03-10',
      bench: ['Arvind Rao'],
      pageText: [],
    });
    expect(j?.sha256).not.toBe(hash);
    expect(j?.redactedText).toHaveLength(1);
    expect(j?.redactionVersion).toBeGreaterThan(0);
    expect(j?.provenance).toMatchObject({ licence: 'CC-BY-4.0', sourceId: HF_SOURCE_ID });
    expect(JSON.stringify(j?.provenance)).toContain(BASE);
    expect([...db.cursors.values()][0]).toMatchObject({ status: 'complete', position: 1 });
  });

  it('anonymises the text, the title and what segmentation reads (redaction fixture)', async () => {
    const db = memoryStore();
    const text = body(
      7,
      'BETWEEN:\nRamesh Kumar ... APPELLANT\n(By Sri. Kiran Raghavan, Advocate)\nAND:\nSuresh Babu ... RESPONDENT\n' +
        'Ramesh Kumar paid Suresh Babu by cheque; Meera Pillai witnessed it. Contact 98450 12345.\n',
    );
    const { source } = memorySource([
      [
        row(7, {
          full_text: text,
          petitioner: 'Ramesh Kumar',
          respondent: 'Suresh Babu',
          title: 'Ramesh Kumar vs Meera Pillai',
        }),
      ],
    ]);
    await runHfImport({ store: db.store, source, now }, request);
    const [j] = db.judgments;
    const stored = JSON.stringify(j);
    for (const name of ['Ramesh', 'Suresh', 'Meera', '98450']) {
      expect(JSON.stringify(j?.redactedText)).not.toContain(name);
    }
    // The raw text is never stored.
    expect(stored).not.toContain('Meera Pillai witnessed');
    // Judges and advocates stay.
    expect(JSON.stringify(j?.redactedText)).toContain('Kiran Raghavan');
    const segments = segmentJudgment(
      (j?.redactedText ?? []).map((p) => ({ pageNo: p.pageNo, text: p.text })),
    );
    expect(segments.length).toBeGreaterThan(0);
    for (const s of segments) expect(JSON.stringify(s)).not.toMatch(/Ramesh|Suresh|Meera/);
  });

  it('masks the dataset title of a sensitive judgment', async () => {
    const db = memoryStore();
    const { source } = memorySource([
      [
        row(8, {
          full_text: body(
            8,
            'This is a case under the POCSO Act, 2012 concerning the victim girl.\n',
          ),
          title: 'State vs Mohan Lal',
          respondent: 'Mohan Lal',
        }),
      ],
    ]);
    await runHfImport({ store: db.store, source, now }, request);
    const [j] = db.judgments;
    expect(j?.titleMasked).toBe(true);
    expect(j?.caseTitle ?? '').not.toContain('Mohan');
  });

  it('stores a repeated text once and records its further CNRs as aliases', async () => {
    const db = memoryStore();
    const text = body(2);
    const { source } = memorySource([
      [
        row(2, { cnr: 'kahc010000022021' }),
        // Same text, other case, spacing and punctuation, other CNR.
        row(3, {
          cnr: 'KAHC010000032021',
          full_text: `  ${text.toUpperCase().replace(/\./g, ' ')}  `,
        }),
        row(4, { cnr: 'KAHC010000032021', full_text: text }),
      ],
    ]);
    const report = await runHfImport({ store: db.store, source, now }, request);
    expect(normaliseText(text.toUpperCase())).toBe(normaliseText(text));
    expect(report).toMatchObject({ inserted: 1, duplicates: 2, aliases: 1 });
    expect(db.judgments).toHaveLength(1);
    expect(db.judgments[0]?.cnr).toBe('KAHC010000022021');
    expect(db.aliases).toEqual([
      { cnr: 'KAHC010000032021', judgmentId: 'j1', sourceId: HF_SOURCE_ID },
    ]);
  });

  it('drops empty, short, stuttering and garbled texts and counts each reason', async () => {
    const db = memoryStore();
    const { source } = memorySource([
      [
        row(10, { full_text: '   ' }),
        row(11, { full_text: 'IN THE HIGH COURT. Appeal dismissed.' }),
        row(12, { full_text: 'IN IN IN THE THE HIGH HIGH COURT COURT '.repeat(20) }),
        row(13, {
          full_text: Array.from(
            { length: 120 },
            (_, i) => `#${String(i)}@ %${String((i * 7) % 13)}^ ¤`,
          ).join(' '),
        }),
        row(14),
      ],
    ]);
    const report = await runHfImport({ store: db.store, source, now }, request);
    expect(report.dropped).toEqual({ empty: 1, short: 1, repeated: 1, garbled: 1 });
    expect(report).toMatchObject({ rows: 5, inserted: 1 });
    expect(db.judgments).toHaveLength(1);
  });

  it('keeps one row group resident, streams a bounded slice and resumes without re-inserting', async () => {
    const db = memoryStore();
    const reads: [number, number, readonly string[]][] = [];
    const groups = [
      [row(20), row(21)],
      [row(22), row(23)],
      [row(24), row(25)],
    ];
    const { source } = memorySource(groups, reads);

    const first = await runHfImport({ store: db.store, source, now }, request, {
      maxRows: 3,
      maxBytes: 1024 ** 3,
    });
    expect(first).toMatchObject({ inserted: 3, budgetReached: true });
    const cursor = [...db.cursors.values()][0];
    expect(cursor).toMatchObject({ position: 3, status: 'running' });

    const second = await runHfImport({ store: db.store, source, now }, request);
    expect(second).toMatchObject({ inserted: 3, duplicates: 0, budgetReached: false });
    expect(db.judgments).toHaveLength(6);
    expect(new Set(db.judgments.map((j) => j.cnr)).size).toBe(6);

    const third = await runHfImport({ store: db.store, source, now }, request);
    expect(third).toMatchObject({ files: 0, inserted: 0 });
    expect(db.judgments).toHaveLength(6);

    // Every read stays inside one row group.
    for (const [start, end] of reads) {
      expect(Math.floor(start / 2)).toBe(Math.floor((end - 1) / 2));
    }
  });

  it('stops at the byte budget', async () => {
    const db = memoryStore();
    const { source } = memorySource([[row(30)], [row(31)], [row(32)]]);
    const report = await runHfImport({ store: db.store, source, now }, request, {
      maxRows: 100,
      maxBytes: 250,
    });
    expect(report.budgetReached).toBe(true);
    expect(report.inserted).toBe(1);
    expect(report.bytes).toBeLessThan(1024 ** 3);
  });

  it('stops when aborted', async () => {
    const db = memoryStore();
    const { source } = memorySource([[row(33)]]);
    const controller = new AbortController();
    controller.abort();
    const report = await runHfImport(
      { store: db.store, source, now },
      request,
      undefined,
      controller.signal,
    );
    expect(report).toMatchObject({ budgetReached: true, inserted: 0, files: 0 });
  });

  it('reads only the slice: court and reconciled year, skipping texts of groups outside it', async () => {
    const db = memoryStore();
    const reads: [number, number, readonly string[]][] = [];
    const { source } = memorySource(
      [
        [row(40, { court_code: 'DLHC' }), row(41, { court_code: 'DLHC' })],
        [row(42, { year: 2021, decision_date: '2019-05-01' }), row(43)],
      ],
      reads,
    );
    const report = await runHfImport(
      { store: db.store, source, now },
      {
        ...request,
        court: 'kahc',
        yearFrom: 2020,
        yearTo: 2022,
      },
    );
    expect(report).toMatchObject({ rows: 1, inserted: 1 });
    expect(db.judgments.map((j) => j.cnr)).toEqual(['KAHC010000432021']);
    // The first group's texts were never read.
    expect(reads.filter(([s]) => s === 0).map(([, , c]) => c.includes('full_text'))).toEqual([
      false,
    ]);
    expect([...db.cursors.keys()][0]).toContain('#court=kahc;years=2020-2022');
  });
});

describe('HF mapping and quality', () => {
  it('reconciles the year with the decision date and maps the row', () => {
    expect(mapHfRow(row(1, { year: 2020, decision_date: '10-03-2021' }), now())).toMatchObject({
      year: 2021,
      judgmentDate: '2021-03-10',
    });
    expect(mapHfRow(row(1, { year: 2020, decision_date: '1890-01-01' }), now())).toMatchObject({
      year: 2020,
      judgmentDate: null,
    });
    expect(mapHfRow(row(1, { full_text: null }), now())).toBeNull();
    expect(inSlice(row(1), { court: 'DLHC' }, now())).toBe(false);
  });

  it('keeps ordinary judgments above the floor (negative examples)', () => {
    expect(qualityDrop(body(1))).toBeNull();
    expect(qualityDrop(`${body(2)}\nഹൈക്കോടതി ഉത്തരവ് പ്രകാരം അപ്പീൽ തള്ളി.`)).toBeNull();
  });
});

describe('createHfHttpSource', () => {
  const response = (status: number, headers: Record<string, string> = {}, bodyText = '[]') =>
    new Response(status >= 300 && status < 400 ? null : bodyText, { status, headers });

  it('refuses a base URL off the pinned host', () => {
    expect(() => createHfHttpSource('https://evil.example/datasets/a/b/')).toThrow(HfHttpError);
    expect(() => createHfHttpSource('http://huggingface.co/datasets/a/b/')).toThrow(HfHttpError);
  });

  it('refuses a redirect off the pinned hosts', async () => {
    const calls: string[] = [];
    const fetchFn: HfFetch = (url) => {
      calls.push(url);
      return Promise.resolve(response(302, { location: 'https://evil.example/x.parquet' }));
    };
    const source = createHfHttpSource(BASE, fetchFn);
    await expect(source.list('high_courts')).rejects.toThrow(/not pinned/);
    expect(calls).toHaveLength(1);
  });

  it('lists the parquet files of a config through the Hub tree API', async () => {
    const calls: string[] = [];
    const fetchFn: HfFetch = (url) => {
      calls.push(url);
      return Promise.resolve(
        response(
          200,
          {},
          JSON.stringify([
            { type: 'file', path: 'high_courts/train-00001.parquet', size: 5 },
            { type: 'file', path: 'high_courts/README.md', size: 1 },
            { type: 'file', path: 'high_courts/train-00000.parquet', size: 7 },
          ]),
        ),
      );
    };
    const files = await createHfHttpSource(BASE, fetchFn).list('high_courts');
    expect(files.map((f) => f.path)).toEqual([
      'high_courts/train-00000.parquet',
      'high_courts/train-00001.parquet',
    ]);
    expect(calls[0]).toBe(
      'https://huggingface.co/api/datasets/overthelex/indian-court-decisions/tree/main/high_courts?recursive=true',
    );
  });
});
