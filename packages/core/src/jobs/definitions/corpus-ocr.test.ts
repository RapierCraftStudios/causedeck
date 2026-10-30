import { schema, type Queryable } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import type { PageRenderer } from '@causedeck/intelligence';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { PLATFORM_AI_SCOPE } from '../../ai/index.ts';
import { corpusOcr, runCorpusOcr } from './corpus-ocr.ts';

const { judgment, corpusOcrQueue, corpusOcrCall, aiCall } = schema;
const log = { info: vi.fn(), warn: vi.fn() } as never;
const SHA = 'b'.repeat(64);
const PDF = new Uint8Array([1, 2, 3]);

const okRenderer: PageRenderer = {
  open: () =>
    Promise.resolve({
      pageCount: 2,
      renderPage: () => Promise.resolve({ png: new Uint8Array([9, 9]), width: 1, height: 1 }),
      close: () => undefined,
    }),
};
const brokenRenderer: PageRenderer = {
  open: () => Promise.reject(Object.assign(new Error('bad pdf'), { code: 'RENDER_FAILED' })),
};

async function seed(db: Queryable): Promise<string> {
  const [row] = await db
    .insert(judgment)
    .values({
      sourceId: 'aws-open-data-sc',
      court: 'Supreme Court of India',
      caseNumbers: [],
      bench: [],
      sha256: SHA,
      blobKey: `corpus/${SHA}.pdf`,
      provenance: {
        url: 'https://example.test/j.pdf',
        fetchedAt: '2026-10-01T00:00:00Z',
        sha256: SHA,
        sourceId: 'aws-open-data-sc',
        sourceVersion: '1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [
        { pageNo: 1, text: 'typed page one' },
        { pageNo: 2, text: '' },
      ],
    })
    .returning({ id: judgment.id });
  const id = (row as { id: string }).id;
  await db.insert(corpusOcrQueue).values({ judgmentId: id, pageNo: 2 });
  return id;
}

describe('system.corpus.ocr', () => {
  it('is a scheduled system job, one run at a time', () => {
    expect(corpusOcr.name).toBe('system.corpus.ocr');
    expect(corpusOcr.schedule?.cron).toBe('*/10 * * * *');
  });

  it('does nothing while the flag is off', async () => {
    const readBlob = vi.fn();
    const report = await runCorpusOcr({ log }, {}, { enabled: false, readBlob, db: {} as never });
    expect(report.skipped).toBe(true);
    expect(readBlob).not.toHaveBeenCalled();
  });

  it('drains the queue with the mock provider: page text from OCR, row removed, spend on the platform scope', async () => {
    await withTestDb(async (tx) => {
      const id = await seed(tx);
      const report = await runCorpusOcr(
        { log },
        {},
        { db: tx, enabled: true, renderer: okRenderer, readBlob: () => Promise.resolve(PDF) },
      );
      expect(report).toMatchObject({ claimed: 1, done: 1, retried: 0, parked: 0, skipped: false });
      expect(await tx.select().from(corpusOcrQueue)).toHaveLength(0);
      const [row] = await tx.select().from(judgment).where(eq(judgment.id, id));
      const pages = row?.pageText ?? [];
      expect(pages[0]).toEqual({ pageNo: 1, text: 'typed page one' });
      expect(pages[1]).toMatchObject({ pageNo: 2, source: 'ocr' });
      expect(typeof pages[1]?.text).toBe('string');
      const calls = await tx.select().from(corpusOcrCall);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((c) => c.purpose === 'corpus.ocr' && c.status === 'ok')).toBe(true);
      // Nothing was charged or audited to a workspace.
      const [tenant] = await tx.select({ n: sql<number>`count(*)::int` }).from(aiCall);
      expect(tenant?.n).toBe(0);
      expect(PLATFORM_AI_SCOPE).toBe('platform');
    });
  });

  it('retries a failing page with backoff, then parks it with its error and keeps it', async () => {
    await withTestDb(async (tx) => {
      await seed(tx);
      let clock = new Date(Date.now() + 60_000);
      const run = () =>
        runCorpusOcr(
          { log },
          {},
          {
            db: tx,
            enabled: true,
            renderer: brokenRenderer,
            readBlob: () => Promise.resolve(PDF),
            now: () => clock,
          },
        );
      const first = await run();
      expect(first).toMatchObject({ claimed: 1, done: 0, retried: 1 });
      // Backing off: an immediate re-run claims nothing.
      expect((await run()).claimed).toBe(0);
      let parked = 0;
      for (let i = 0; i < 6 && parked === 0; i++) {
        clock = new Date(clock.getTime() + 7 * 3_600_000);
        parked += (await run()).parked;
      }
      expect(parked).toBe(1);
      const [row] = await tx.select().from(corpusOcrQueue);
      expect(row).toMatchObject({ attempts: 5, lastError: 'RENDER_FAILED' });
      expect(row?.parkedAt).not.toBeNull();
      // Parked pages are never claimed again.
      clock = new Date(clock.getTime() + 24 * 3_600_000);
      expect((await run()).claimed).toBe(0);
    });
  });

  it('stops without a failed attempt when the platform AI budget is spent', async () => {
    await withTestDb(async (tx) => {
      await seed(tx);
      // The mock costs nothing, so today's spend is seeded past the cap.
      await tx.insert(corpusOcrCall).values({
        purpose: 'corpus.ocr',
        task: 'ocr',
        provider: 'sarvam',
        model: 'm',
        region: 'in',
        costPaise: 10,
        status: 'ok',
      });
      const report = await runCorpusOcr(
        { log },
        {},
        {
          db: tx,
          enabled: true,
          dailyPaise: 1,
          renderer: okRenderer,
          readBlob: () => Promise.resolve(PDF),
        },
      );
      expect(report).toMatchObject({ done: 0, retried: 0, parked: 0, budgetReached: true });
      const [row] = await tx.select().from(corpusOcrQueue);
      expect(row?.attempts).toBe(0);
    });
  });
});
