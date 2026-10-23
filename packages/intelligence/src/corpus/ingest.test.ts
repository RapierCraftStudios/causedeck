import type { Queryable } from '@causedeck/db';
import { describe, expect, it, vi } from 'vitest';

import { bodyBytes, ingestJudgment, type CorpusFetcher } from './ingest.ts';

/** A one-table in-memory stand-in for the `judgment` queries `ingestJudgment` makes. */
function fakeDb() {
  const rows: { id: string; sha256: string; values: Record<string, unknown> }[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows.slice(0, 1).map((r) => ({ id: r.id }))),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown> & { sha256: string }) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (rows.some((r) => r.sha256 === values.sha256)) return Promise.resolve([]);
            const id = `j${String(rows.length + 1)}`;
            rows.push({ id, sha256: values.sha256, values });
            return Promise.resolve([{ id }]);
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as Queryable, rows };
}

const provenance = (sha256: string) => ({
  url: 'https://mhc.example/j/1.pdf',
  fetchedAt: '2026-10-23T00:00:00.000Z',
  sha256,
  sourceId: 'in.mhc.judgments',
  sourceVersion: 'v1',
  tierUsed: 'http',
  costDollars: 0,
});

const fetcherFor = (sha256: string): CorpusFetcher => ({
  fetchSource: () =>
    Promise.resolve({ body: '%PDF-1.4', contentType: 'application/pdf', provenance: provenance(sha256) }),
});

const readPdf = () =>
  Promise.resolve([{ pageNo: 1, text: 'DATED: 21.10.2026\n2026:MHC:1234\nORDER' }]);

describe('ingestJudgment', () => {
  it('stores the text layer and header, then treats the same PDF as a no-op', async () => {
    const { db, rows } = fakeDb();
    const deps = { db, fetcher: fetcherFor('aa'), readPdf };
    const input = { sourceId: 'in.mhc.judgments', url: 'https://mhc.example/j/1.pdf' };

    const first = await ingestJudgment(deps, input);
    expect(first).toMatchObject({ status: 'inserted', sha256: 'aa' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values).toMatchObject({
      court: 'MHC',
      neutralCitation: '2026:MHC:1234',
      judgmentDate: '2026-10-21',
      pageText: [{ pageNo: 1, text: expect.any(String) }],
    });

    const again = await ingestJudgment(deps, input);
    expect(again).toMatchObject({ status: 'duplicate', judgmentId: first.status === 'inserted' ? first.judgmentId : '' });
    expect(rows).toHaveLength(1);
  });

  it('does not read the PDF of a duplicate', async () => {
    const { db } = fakeDb();
    const read = vi.fn(readPdf);
    const deps = { db, fetcher: fetcherFor('bb'), readPdf: read };
    const input = { sourceId: 'in.mhc.judgments', url: 'https://mhc.example/j/1.pdf' };
    await ingestJudgment(deps, input);
    await ingestJudgment(deps, input);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reports an unreadable PDF without storing it', async () => {
    const { db, rows } = fakeDb();
    const out = await ingestJudgment(
      { db, fetcher: fetcherFor('cc'), readPdf: () => Promise.reject(new Error('corrupt')) },
      { sourceId: 'in.mhc.judgments', url: 'https://mhc.example/j/1.pdf' },
    );
    expect(out).toEqual({ status: 'unreadable', sha256: 'cc' });
    expect(rows).toHaveLength(0);
  });
});

describe('bodyBytes', () => {
  it('reads a %PDF body as bytes and other PDF bodies as base64', () => {
    expect(Buffer.from(bodyBytes('%PDF-1.4', 'application/pdf')).toString('latin1')).toBe('%PDF-1.4');
    expect(Buffer.from(bodyBytes('JVBERi0=', 'application/pdf')).toString('latin1')).toBe('%PDF-');
  });
});
