import { createHash } from 'node:crypto';

import { schema, type Queryable } from '@causedeck/db';
import { describe, expect, it } from 'vitest';

import { mapMetadataRow } from './metadata.ts';
import { listArchives, metadataKey, runBulkImport, type BulkImportDeps } from './import.ts';
import { BulkHttpError, createS3HttpSource } from './s3-http.ts';
import { readTar } from './tar.ts';
import type { BulkObjectSource } from './types.ts';

const { judgment, corpusImportCursor, corpusOcrQueue } = schema;

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

/** In-memory stand-in for the three tables the importer touches. */
function fakeDb() {
  const judgments: { id: string; sha256: string; values: Record<string, unknown> }[] = [];
  const cursors: Record<string, unknown>[] = [];
  const queue: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        return {
          where: (cond: unknown) => ({
            limit: () => {
              if (table !== judgment) return Promise.resolve(cursors.slice(0, 1));
              const sha = /[0-9a-f]{64}/.exec(
                JSON.stringify(cond, (k, v: unknown) => (k === 'table' ? undefined : v)),
              )?.[0];
              return Promise.resolve(
                judgments.filter((r) => r.sha256 === sha).map((r) => ({ id: r.id })),
              );
            },
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> & { sha256?: string }) => ({
        onConflictDoNothing: () => {
          if (table === corpusImportCursor) {
            if (cursors.length === 0) {
              cursors.push({ id: 'c1', position: 0, status: 'pending', ...values });
            }
            return Promise.resolve();
          }
          if (table === corpusOcrQueue) {
            queue.push(...(values as unknown as Record<string, unknown>[]));
            return Promise.resolve();
          }
          return {
            returning: () => {
              if (judgments.some((r) => r.sha256 === values.sha256)) return Promise.resolve([]);
              const id = `j${String(judgments.length + 1)}`;
              judgments.push({ id, sha256: values.sha256 ?? '', values });
              return Promise.resolve([{ id }]);
            },
          };
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const { position, status } = values;
          if (position !== undefined) cursors[0] = { ...cursors[0], position };
          if (status !== undefined) cursors[0] = { ...cursors[0], status };
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db: db as unknown as Queryable, judgments, cursors, queue };
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
