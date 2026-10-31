// `system.corpus.segment` (#893): redacted judgments are segmented from `redacted_text` with no
// loss, a backfill picks up unsegmented rows, a second run is a no-op, a re-redaction replaces the
// segments, and unredacted rows are left alone.
import { randomUUID } from 'node:crypto';

import { schema, type Queryable } from '@causedeck/db';
import { closeTestDb, withTestDb } from '@causedeck/db/testing';
import { SEGMENT_VERSION } from '@causedeck/intelligence';
import { asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { courtLevelOf, judgmentYearOf, runCorpusSegment } from './corpus-segment.ts';

afterAll(async () => {
  await closeTestDb();
});

const ctx = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as never;

const REDACTED = [
  {
    pageNo: 1,
    text: 'IN THE HIGH COURT OF MADRAS\nthe Appellant versus the Respondent\n\n1. The Appellant filed a complaint on 14.02.2019 and the FIR was registered.',
  },
  {
    pageNo: 2,
    text: '2. We are of the view that the test is not met.\n\n3. In the result, the appeal is dismissed.',
  },
];
const RAW = [{ pageNo: 1, text: 'RAW TEXT WITH Ramesh Kumar' }];

async function insert(
  db: Queryable,
  opts: { redactionVersion?: number; segmentVersion?: number; date?: string | null } = {},
): Promise<string> {
  const sha256 = randomUUID().replaceAll('-', '');
  const [row] = await db
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      judgmentDate: opts.date === undefined ? '2019-03-04' : opts.date,
      provenance: {
        url: 'https://mhc.example/j/s.pdf',
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: RAW,
      redactedText: opts.redactionVersion === 0 ? null : REDACTED,
      redactionVersion: opts.redactionVersion ?? 1,
      segmentVersion: opts.segmentVersion ?? 0,
    })
    .returning({ id: schema.judgment.id });
  return row?.id ?? '';
}

const segmentsOf = (db: Queryable, id: string) =>
  db
    .select()
    .from(schema.judgmentSegment)
    .where(eq(schema.judgmentSegment.judgmentId, id))
    .orderBy(asc(schema.judgmentSegment.ordinal));

describe('runCorpusSegment', () => {
  it('segments a redacted judgment from redacted_text, losslessly, and is idempotent', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never as Queryable;
      const id = await insert(db);
      const report = await runCorpusSegment(ctx, { batch: 500 }, { db });
      expect(report.segmented).toBeGreaterThanOrEqual(1);

      const segs = await segmentsOf(db, id);
      expect(segs.length).toBeGreaterThan(0);
      expect(segs.map((s) => s.text).join('')).toBe(REDACTED.map((p) => p.text).join('\n'));
      expect(segs.map((s) => s.text).join('')).not.toContain('Ramesh');
      expect(segs.every((s) => s.judgmentYear === 2019 && s.court === 'MHC')).toBe(true);
      expect(segs[0]?.courtLevel).toBe('high_court');
      expect(Math.max(...segs.map((s) => s.pageTo))).toBe(2);

      const [j] = await db.select().from(schema.judgment).where(eq(schema.judgment.id, id));
      expect(j?.segmentVersion).toBe(SEGMENT_VERSION);
      expect(j?.segmentedRedactionVersion).toBe(1);

      const again = await runCorpusSegment(ctx, { batch: 500 }, { db });
      expect(again.segmented).toBe(0);
      expect((await segmentsOf(db, id)).length).toBe(segs.length);
    });
  });

  it('replaces the segments after a re-redaction and skips unredacted rows', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never as Queryable;
      const id = await insert(db);
      const unredacted = await insert(db, { redactionVersion: 0 });
      await runCorpusSegment(ctx, { batch: 500 }, { db });

      await db
        .update(schema.judgment)
        .set({
          redactedText: [{ pageNo: 1, text: 'In the result, the appeal is allowed.' }],
          redactionVersion: 2,
        })
        .where(eq(schema.judgment.id, id));
      const report = await runCorpusSegment(ctx, { batch: 500 }, { db });
      expect(report.segmented).toBe(1);

      const segs = await segmentsOf(db, id);
      expect(segs.map((s) => s.text)).toEqual(['In the result, the appeal is allowed.']);
      expect(segs[0]?.role).toBe('decision');
      expect(await segmentsOf(db, unredacted)).toEqual([]);
    });
  });
});

describe('segment helpers', () => {
  it('derives the court level and the partition year', () => {
    expect(courtLevelOf('INSC')).toBe('supreme_court');
    expect(courtLevelOf('MHC')).toBe('high_court');
    expect(courtLevelOf('KHC-D')).toBe('high_court');
    expect(courtLevelOf('NCDRC')).toBe('other');
    const createdAt = new Date('2026-10-01T00:00:00Z');
    expect(judgmentYearOf({ judgmentDate: '1975-01-02', neutralCitation: null, createdAt })).toBe(
      1975,
    );
    expect(judgmentYearOf({ judgmentDate: null, neutralCitation: '2021:MHC:12', createdAt })).toBe(
      2021,
    );
    expect(judgmentYearOf({ judgmentDate: null, neutralCitation: null, createdAt })).toBe(2026);
  });
});
