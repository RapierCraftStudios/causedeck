import { createHash } from 'node:crypto';

import type { Queryable } from '@causedeck/db';
import { describe, expect, it, vi } from 'vitest';

import { fakeDb } from './__tests__/fake-db.ts';
import type { readParquetRows } from './parquet.ts';
import { mapMetadataRow, METADATA_COLUMNS } from './metadata.ts';
import {
  BULK_PROGRESS_EVERY,
  entryMetadata,
  listArchives,
  metadataKey,
  runBulkImport,
  type BulkImportDeps,
} from './import.ts';
import { BulkHttpError, createS3HttpSource } from './s3-http.ts';
import { readTar } from './tar.ts';
import type { BulkObjectSource } from './types.ts';

/** A ustar archive of `files`, as one chunk list of arbitrary sizes. */
function tar(files: Record<string, string>): Uint8Array {
  const parts: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 'utf8');
    header.write(`${Buffer.byteLength(content).toString(8).padStart(11, '0')}\0`, 124, 'ascii');
    header.write('0', 156, 'ascii');
    parts.push(
      header,
      Buffer.from(content),
      Buffer.alloc((512 - (Buffer.byteLength(content) % 512)) % 512),
    );
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function* sliceChunks(bytes: Uint8Array, size: number): Generator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

function chunks(bytes: Uint8Array, size = 700): AsyncIterable<Uint8Array> {
  return ReadableStream.from(sliceChunks(bytes, size));
}

const ARCHIVE = 'data/tar/year=2023/english/english.tar';
const BASE = 'https://indian-supreme-court-judgments.s3.ap-south-1.amazonaws.com/';

function objects(files: Record<string, string>, streamed: string[] = []): BulkObjectSource {
  const archive = tar(files);
  return {
    list: (prefix) =>
      Promise.resolve(
        [ARCHIVE, 'data/tar/year=2023/english/readme.txt'].filter((k) => k.startsWith(prefix)),
      ),
    read: () => Promise.reject(new Error('no metadata')),
    stream: (key) => {
      streamed.push(key);
      return chunks(archive);
    },
  };
}

const pdfs = {
  'a.pdf': 'DATED: 21.10.2023 first judgment with a long enough text layer to be readable',
  'b.pdf': 'second judgment body, also long enough to count as a real text layer page',
  'c.pdf': 'third',
  'notes.txt': 'not a pdf',
};

function deps(over: Partial<BulkImportDeps> & { db: Queryable }): BulkImportDeps {
  return {
    objects: objects(pdfs),
    // The "PDF" is its own text: one page per entry.
    readPdf: (data) => Promise.resolve([{ pageNo: 1, text: Buffer.from(data).toString('utf8') }]),
    concurrency: 2,
    now: () => new Date('2026-10-30T00:00:00Z'),
    ...over,
  };
}

const request = { dataset: 'sc' as const, sourceId: 'aws-open-data-sc', baseUrl: BASE };

/** `n` distinct readable PDFs, `p001.pdf`… in archive order. */
function manyPdfs(n: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 1; i <= n; i += 1) {
    files[`p${String(i).padStart(3, '0')}.pdf`] =
      `judgment number ${String(i)} with a text layer long enough to count as readable`;
  }
  return files;
}

function spyLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const messages = (fn: ReturnType<typeof vi.fn>, msg: string): Record<string, unknown>[] =>
  fn.mock.calls.filter((c) => c[1] === msg).map((c) => c[0] as Record<string, unknown>);

const urls = (rows: { values: Record<string, unknown> }[]): string[] =>
  rows.map((r) => (r.values as { provenance: { url: string } }).provenance.url);

describe('runBulkImport', () => {
  it('stores judgments with dataset provenance and licence, and queues text-less pages for OCR', async () => {
    const { db, judgments, queue, cursors } = fakeDb();
    const report = await runBulkImport(deps({ db }), request);
    expect(report).toMatchObject({ archives: 1, inserted: 3, duplicates: 0, failed: 0 });
    const first = judgments[0]?.values as { provenance: Record<string, string>; sha256: string };
    expect(first.provenance).toMatchObject({
      url: `${BASE}${ARCHIVE}#a.pdf`,
      sourceId: 'aws-open-data-sc',
      licence: 'CC-BY-4.0',
      sha256: createHash('sha256').update(pdfs['a.pdf']).digest('hex'),
    });
    // `c.pdf` has a three-word text layer: its page is queued, not dropped.
    expect(queue).toEqual([{ judgmentId: 'j3', pageNo: 1 }]);
    expect(judgments).toHaveLength(3);
    expect(cursors[0]).toMatchObject({ status: 'complete', position: 3 });
  });

  it('adds nothing on a re-run (sha256 dedupe)', async () => {
    const { db, judgments, cursors } = fakeDb();
    await runBulkImport(deps({ db }), request);
    cursors[0] = { ...cursors[0], status: 'pending', position: 0 };
    const again = await runBulkImport(deps({ db }), request);
    expect(again).toMatchObject({ inserted: 0, duplicates: 3 });
    expect(judgments).toHaveLength(3);
  });

  it('stops on the page budget and resumes from its cursor', async () => {
    const { db, judgments, cursors } = fakeDb();
    const first = await runBulkImport(deps({ db }), request, { maxPages: 2, maxBytes: 1e9 });
    expect(first).toMatchObject({ inserted: 2, budgetReached: true });
    expect(cursors[0]).toMatchObject({ status: 'running', position: 2 });
    const second = await runBulkImport(deps({ db }), request);
    expect(second).toMatchObject({ inserted: 1, budgetReached: false });
    expect(
      judgments.map((r) => (r.values as { provenance: { url: string } }).provenance.url),
    ).toEqual([`${BASE}${ARCHIVE}#a.pdf`, `${BASE}${ARCHIVE}#b.pdf`, `${BASE}${ARCHIVE}#c.pdf`]);
  });

  it('skips a completed archive without reading it', async () => {
    const { db, cursors } = fakeDb();
    await runBulkImport(deps({ db }), request);
    const streamed: string[] = [];
    const report = await runBulkImport(deps({ db, objects: objects(pdfs, streamed) }), request);
    expect(report.archives).toBe(0);
    expect(streamed).toEqual([]);
    expect(cursors[0]).toMatchObject({ status: 'complete' });
  });

  it('uses the dataset metadata for fields the PDF text does not give', async () => {
    const { db, judgments } = fakeDb();
    const source = objects({
      'a.pdf': 'plain text without any header at all, long enough to read ok',
    });
    await runBulkImport(
      deps({
        db,
        objects: { ...source, read: () => Promise.resolve(new Uint8Array()) },
        parquet: () =>
          Promise.resolve([{ path: 'x/a.pdf', judge: 'A B, C D', decision_date: '2023-05-04' }]),
      }),
      request,
    );
    expect(judgments[0]?.values).toMatchObject({
      bench: ['A B', 'C D'],
      judgmentDate: '2023-05-04',
    });
  });
});

describe('runBulkImport on the Supreme Court dataset (#1189)', () => {
  const scFiles = {
    '2008_9_821_869_EN.pdf': 'english judgment text, long enough to be a readable text layer here',
    '2008_9_821_869_HI.pdf': 'hindi translation text, long enough to be a readable text layer too',
    'judgment-7.pdf': 'a member whose name carries no SCR citation, long enough to read ok',
  };

  it('stores the SCR citation of the member name in case_numbers and the court INSC', async () => {
    const { db, judgments } = fakeDb();
    await runBulkImport(deps({ db, objects: objects(scFiles) }), request);
    const stored = judgments.map(
      (r) => r.values as { court: string; caseNumbers: string[]; neutralCitation: string | null },
    );
    expect(stored).toHaveLength(3);
    expect(stored[0]).toMatchObject({
      court: 'INSC',
      caseNumbers: ['[2008] 9 SCR 821'],
      neutralCitation: null,
    });
    // The regional-language translation and the malformed name store no citation.
    expect(stored[1]).toMatchObject({ court: 'INSC', caseNumbers: [] });
    expect(stored[2]).toMatchObject({ court: 'INSC', caseNumbers: [] });
    expect(stored.every((r) => r.court !== 'aws-open-data-sc')).toBe(true);
  });

  it('keeps the Parquet case number and adds the SCR citation after it', () => {
    const row = mapMetadataRow({ case_no: 'C.A. 1 of 2008', court_code: 'SC' });
    expect(entryMetadata('aws-open-data-sc', '2008_9_821_869_EN.pdf', row)).toMatchObject({
      court: 'INSC',
      caseNumbers: ['C.A. 1 of 2008'],
      reporterCitations: ['[2008] 9 SCR 821'],
    });
  });

  it('leaves High Court metadata as the Parquet gives it', () => {
    const row = mapMetadataRow({ court_code: '33_10', case_no: 'W.P. 1 of 2023' });
    expect(entryMetadata('aws-open-data-hc', '2008_9_821_869_EN.pdf', row)).toEqual(row);
    expect(entryMetadata('aws-open-data-hc', 'a.pdf', undefined)).toEqual({});
  });
});

describe('runBulkImport logging and resume (#1185)', () => {
  it('logs progress every 100 entries and a final report line', async () => {
    expect(BULK_PROGRESS_EVERY).toBe(100);
    const { db } = fakeDb();
    const log = spyLog();
    const report = await runBulkImport(deps({ db, log, objects: objects(manyPdfs(250)) }), request);
    expect(report).toMatchObject({ inserted: 250, failed: 0, budgetReached: false });
    const progress = messages(log.info, 'corpus.bulk_import progress');
    expect(progress.map((p) => p.handled)).toEqual([100, 200]);
    expect(progress[1]).toMatchObject({ archiveKey: ARCHIVE, position: 200, inserted: 200 });
    const final = messages(log.info, 'corpus.bulk_import report');
    expect(final).toEqual([report]);
    expect(log.error).not.toHaveBeenCalled();

    // A stream that dies mid-archive: a structured error line, the error rethrown, no report line.
    const broken = spyLog();
    const archive = tar(manyPdfs(250));
    const source: BulkObjectSource = {
      ...objects({}),
      stream: async function* () {
        yield archive.subarray(0, Math.floor(archive.length / 2));
        await Promise.resolve();
        throw new TypeError('socket hang up');
      },
    };
    await expect(
      runBulkImport(deps({ db: fakeDb().db, log: broken, objects: source }), request),
    ).rejects.toThrow('socket hang up');
    expect(broken.error).toHaveBeenCalledTimes(1);
    expect(broken.error.mock.calls[0]?.[0]).toMatchObject({
      archiveKey: ARCHIVE,
      error: 'TypeError',
    });
    expect((broken.error.mock.calls[0]?.[0] as { position: number }).position).toBeGreaterThan(0);
    expect(messages(broken.info, 'corpus.bulk_import report')).toEqual([]);
  });

  it('warns with a structured line for a failed entry, without its content', async () => {
    const { db } = fakeDb();
    const log = spyLog();
    const report = await runBulkImport(
      deps({
        db,
        log,
        readPdf: (data) => {
          const text = Buffer.from(data).toString('utf8');
          return text.startsWith('second')
            ? Promise.reject(new Error('Invalid PDF structure'))
            : Promise.resolve([{ pageNo: 1, text }]);
        },
        blobs: {
          put: (key) =>
            key.includes(createHash('sha256').update(pdfs['c.pdf']).digest('hex'))
              ? Promise.reject(new RangeError('store down'))
              : Promise.resolve(),
        },
      }),
      request,
    );
    expect(report).toMatchObject({ inserted: 1, failed: 2 });
    const failed = messages(log.warn, 'corpus.bulk_import entry failed');
    expect(failed).toEqual([
      { archiveKey: ARCHIVE, entry: 'b.pdf', reason: 'unreadable' },
      { archiveKey: ARCHIVE, entry: 'c.pdf', reason: 'store_failed', error: 'RangeError' },
    ]);
    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls]);
    expect(logged).not.toContain('second judgment');
    expect(logged).not.toContain('store down');
  });

  it('resumes exactly after a mid-archive budget stop', async () => {
    const files = manyPdfs(250);
    const { db, judgments, cursors } = fakeDb();
    const run = (budget?: { maxPages: number; maxBytes: number }) =>
      runBulkImport(deps({ db, concurrency: 4, objects: objects(files) }), request, budget);
    const first = await run({ maxPages: 137, maxBytes: 1e12 });
    expect(first.budgetReached).toBe(true);
    // The budget is checked after each batch of 4: the stop lands on the batch past 137.
    expect(first.inserted).toBe(140);
    expect(cursors[0]).toMatchObject({ status: 'running', position: 140 });
    const second = await run();
    expect(second).toMatchObject({ inserted: 110, duplicates: 0, budgetReached: false });
    const expected = Object.keys(files).map((name) => `${BASE}${ARCHIVE}#${name}`);
    expect(urls(judgments)).toEqual(expected);
    expect(cursors[0]).toMatchObject({ status: 'complete', position: 250 });
    // A full re-run from position 0 adds nothing.
    cursors[0] = { ...cursors[0], status: 'pending', position: 0 };
    const third = await run();
    expect(third).toMatchObject({ inserted: 0, duplicates: 250 });
    expect(judgments).toHaveLength(250);
  });

  it('calls afterBatch after each committed batch that inserted, never on a duplicates-only re-run (#1197)', async () => {
    const { db, cursors } = fakeDb();
    const seen: { inserted: number; position: unknown }[] = [];
    const afterBatch = vi.fn(({ inserted }: { inserted: number }) => {
      // The batch's cursor is already committed when the hook runs.
      seen.push({ inserted, position: cursors[0]?.position });
      return Promise.resolve();
    });
    const report = await runBulkImport(
      deps({ db, concurrency: 4, objects: objects(manyPdfs(10)), afterBatch }),
      request,
    );
    expect(report.inserted).toBe(10);
    expect(seen).toEqual([
      { inserted: 4, position: 4 },
      { inserted: 4, position: 8 },
      { inserted: 2, position: 10 },
    ]);

    cursors[0] = { ...cursors[0], status: 'pending', position: 0 };
    afterBatch.mockClear();
    const again = await runBulkImport(
      deps({ db, concurrency: 4, objects: objects(manyPdfs(10)), afterBatch }),
      request,
    );
    expect(again).toMatchObject({ inserted: 0, duplicates: 10 });
    expect(afterBatch).not.toHaveBeenCalled();
  });

  it('reads only the metadata columns it maps', async () => {
    const { db } = fakeDb();
    const parquet = vi.fn<typeof readParquetRows>(() =>
      Promise.resolve([{ path: 'a.pdf', decision_date: '2023-05-04' }]),
    );
    await runBulkImport(
      deps({
        db,
        objects: { ...objects(pdfs), read: () => Promise.resolve(new Uint8Array()) },
        parquet,
      }),
      request,
    );
    expect(parquet).toHaveBeenCalledTimes(1);
    expect(parquet.mock.calls[0]?.[1]).toEqual(METADATA_COLUMNS);
    for (const column of ['path', 'cnr', 'judge', 'decision_date', 'nc_display']) {
      expect(METADATA_COLUMNS).toContain(column);
    }
  });
});

describe('bulk helpers', () => {
  it('lists only the tar archives in the year range and court', async () => {
    const source: BulkObjectSource = {
      ...objects(pdfs),
      list: () =>
        Promise.resolve([
          'data/tar/year=2022/court=33_10/bench=a/pdfs.tar',
          'data/tar/year=2023/court=33_10/bench=a/pdfs.tar',
          'data/tar/year=2023/court=29_3/bench=a/pdfs.tar',
          'data/tar/year=2023/court=33_10/bench=a/index.json',
        ]),
    };
    const found = await listArchives(source, {
      ...request,
      dataset: 'hc',
      court: '33_10',
      yearFrom: 2023,
      yearTo: 2023,
    });
    expect(found.map((f) => f.key)).toEqual(['data/tar/year=2023/court=33_10/bench=a/pdfs.tar']);
    expect(metadataKey('data/tar/year=2023/court=33_10/bench=a/pdfs.tar')).toBe(
      'metadata/parquet/year=2023/court=33_10/bench=a/metadata.parquet',
    );
  });

  it('reads a tar stream split across chunks', async () => {
    const names: string[] = [];
    for await (const e of readTar(chunks(tar({ 'a.pdf': 'x'.repeat(1000), 'b.pdf': 'y' }), 100))) {
      names.push(`${e.name}:${String(e.data.length)}`);
    }
    expect(names).toEqual(['a.pdf:1000', 'b.pdf:1']);
  });

  it('maps metadata columns leniently', () => {
    expect(
      mapMetadataRow({ judge: 'X; Y', decision_date: '04-05-2023', case_no: 'W.P. 1 of 2023' }),
    ).toEqual({
      court: null,
      neutralCitation: null,
      caseNumbers: ['W.P. 1 of 2023'],
      bench: ['X', 'Y'],
      judgmentDate: '2023-05-04',
    });
    expect(mapMetadataRow({})).toMatchObject({ caseNumbers: [], bench: [], judgmentDate: null });
  });

  it('lists a public bucket anonymously, page by page, and refuses another host', async () => {
    const urls: string[] = [];
    const pages = [
      '<IsTruncated>true</IsTruncated><NextContinuationToken>t1</NextContinuationToken><Key>a&amp;b.tar</Key>',
      '<IsTruncated>false</IsTruncated><Key>c.tar</Key>',
    ];
    const source = createS3HttpSource(BASE, (url) => {
      urls.push(url);
      return Promise.resolve(new Response(pages.shift() ?? ''));
    });
    expect(await source.list('data/')).toEqual(['a&b.tar', 'c.tar']);
    expect(urls[1]).toContain('continuation-token=t1');
    await expect(
      createS3HttpSource(BASE, () => Promise.resolve(new Response('', { status: 404 }))).read('k'),
    ).rejects.toThrow('404');
  });

  it('opens only the two dataset buckets, over https', () => {
    const ok = () => Promise.resolve(new Response(''));
    expect(() => createS3HttpSource('https://example.com/', ok)).toThrow(BulkHttpError);
    expect(() =>
      createS3HttpSource('http://indian-supreme-court-judgments.s3.ap-south-1.amazonaws.com/', ok),
    ).toThrow(BulkHttpError);
    expect(() =>
      createS3HttpSource('https://indian-high-court-judgments.s3.ap-south-1.amazonaws.com/', ok),
    ).not.toThrow();
  });
});
