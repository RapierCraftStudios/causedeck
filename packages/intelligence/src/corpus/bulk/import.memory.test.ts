// Memory bound of the bulk importer (#1185): a year archive (about 1 GB, about 1,000 PDFs) streamed
// through the real tar reader, PDF text layer and `storeJudgment` must keep RSS under 1 GB and flat
// (within 150 MB after warm-up). Run it under a 768 MB heap in a forked worker:
//   NODE_OPTIONS=--max-old-space-size=768 pnpm exec vitest run src/corpus/bulk/import.memory.test.ts --pool=forks --maxWorkers=1
// BULK_MEMORY_TEST_ENTRIES shrinks the archive for local iteration (default 1000).
import { describe, expect, it } from 'vitest';

import { fakeDb } from './__tests__/fake-db.ts';
import { runBulkImport } from './import.ts';
import type { BulkObjectSource } from './types.ts';

// eslint-disable-next-line no-process-env -- the documented knob to shrink the archive locally.
const ENTRIES = Number(process.env.BULK_MEMORY_TEST_ENTRIES ?? '1000');
const PADDING = 1024 * 1024;
const CHUNK = 64 * 1024;
const BLOCK = 512;
const MB = 1024 * 1024;

const ARCHIVE = 'data/tar/year=2023/english/english.tar';
const BASE = 'https://indian-supreme-court-judgments.s3.ap-south-1.amazonaws.com/';

/** A valid one-page PDF with a text layer and an unreferenced uncompressed padding stream. */
function pdf(index: number): Buffer {
  const text = `IN THE SUPREME COURT OF INDIA. Judgment number ${String(index)} of the synthetic memory archive, with a text layer long enough to read.`;
  const content = `BT /F1 10 Tf 40 760 Td (${text}) Tj ET`;
  const padding = Buffer.alloc(PADDING, index % 251);
  padding.write(`unique padding ${String(index)}`, 0, 'ascii');
  const objects: (string | Buffer)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    ],
    [`<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [`<< /Length ${String(padding.length)} >>\nstream\n`, padding, '\nendstream'],
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  let length = parts[0]?.length ?? 0;
  const offsets: number[] = [];
  for (const [i, pieces] of objects.entries()) {
    offsets.push(length);
    for (const piece of [`${String(i + 1)} 0 obj\n`, ...pieces, '\nendobj\n']) {
      const buf = typeof piece === 'string' ? Buffer.from(piece, 'latin1') : piece;
      parts.push(buf);
      length += buf.length;
    }
  }
  const xref = [
    'xref',
    `0 ${String(objects.length + 1)}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>`,
    `startxref\n${String(length)}\n%%EOF\n`,
  ].join('\n');
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 'utf8');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  header.write('0', 156, 'ascii');
  return header;
}

/**
 * The archive, generated lazily in 64 KB chunks: one PDF exists at a time, the archive never does.
 * `onEntry` sees each entry index as it is generated.
 */
async function* archive(onEntry: (index: number) => void): AsyncGenerator<Uint8Array> {
  for (let i = 1; i <= ENTRIES; i += 1) {
    onEntry(i);
    const body = pdf(i);
    const padded = Math.ceil(body.length / BLOCK) * BLOCK;
    const bytes = Buffer.concat([
      tarHeader(`sc/2023/judgment-${String(i).padStart(5, '0')}.pdf`, body.length),
      body,
      Buffer.alloc(padded - body.length),
    ]);
    for (let at = 0; at < bytes.length; at += CHUNK)
      yield Buffer.from(bytes.subarray(at, at + CHUNK));
    // Let the importer's awaits interleave with generation, as a network stream does.
    await new Promise((resolve) => setImmediate(resolve));
  }
  yield Buffer.alloc(2 * BLOCK);
}

describe('runBulkImport memory (#1185)', () => {
  it(
    `imports ${String(ENTRIES)} PDFs of about 1 MB with RSS under 1 GB and flat`,
    async () => {
      const samples: { entry: number; rss: number }[] = [];
      const sample = (entry: number): void => {
        if (entry % 25 === 0) samples.push({ entry, rss: process.memoryUsage().rss });
      };
      const source: BulkObjectSource = {
        list: (prefix) => Promise.resolve([ARCHIVE].filter((k) => k.startsWith(prefix))),
        read: () => Promise.reject(new Error('no metadata')),
        stream: () => archive(sample),
      };
      const { db, cursors, judgments } = fakeDb();
      const deps = { db, objects: source, blobs: null };
      const request = { dataset: 'sc' as const, sourceId: 'aws-open-data-sc', baseUrl: BASE };
      const budget = { maxPages: 1_000_000, maxBytes: 50 * 1024 ** 3 };

      const report = await runBulkImport(deps, request, budget);
      expect(report).toMatchObject({ inserted: ENTRIES, failed: 0, budgetReached: false });
      expect(report.bytes).toBeGreaterThan(ENTRIES * PADDING);

      const peak = Math.max(...samples.map((s) => s.rss), process.memoryUsage().rss);
      const warm = samples.filter((s) => s.entry > Math.min(100, ENTRIES / 4)).map((s) => s.rss);
      const spread = warm.length === 0 ? 0 : Math.max(...warm) - Math.min(...warm);
      // Kept in the test output: the measured envelope, for the PR and for regressions.
      console.info(
        `bulk memory: ${String(ENTRIES)} entries, peak ${(peak / MB).toFixed(0)} MB, spread ${(spread / MB).toFixed(0)} MB`,
      );
      expect(peak).toBeLessThan(1024 * MB);
      expect(spread).toBeLessThanOrEqual(150 * MB);

      // A second full pass over the same archive stores nothing new.
      cursors[0] = { ...cursors[0], status: 'pending', position: 0 };
      const again = await runBulkImport(deps, request, budget);
      expect(again).toMatchObject({ inserted: 0, duplicates: ENTRIES, failed: 0 });
      expect(judgments).toHaveLength(ENTRIES);
    },
    15 * 60_000,
  );
});
