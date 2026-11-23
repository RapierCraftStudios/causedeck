// verifyPinpoint (#1135) over a real database: paragraph and page pinpoints, quote normalisation,
// the page fallback for unnumbered text, and that only `redacted_text` is ever read.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { verifyPinpoint } from './verify-quote.ts';

const QUOTE = 'the duty of care is owed to every passenger';

async function seed(
  tx: Transaction,
  redactedText: schema.JudgmentPageText[] | null,
  pageText: schema.JudgmentPageText[] = [{ pageNo: 1, text: 'raw' }],
): Promise<string> {
  const [row] = await tx
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256: randomUUID().replaceAll('-', ''),
      provenance: {
        url: 'https://mhc.example/j/q.pdf',
        fetchedAt: '2026-11-01T00:00:00.000Z',
        sha256: 'q',
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText,
      redactedText,
    })
    .returning({ id: schema.judgment.id });
  if (row === undefined) throw new Error('not inserted');
  return row.id;
}

const NUMBERED: schema.JudgmentPageText[] = [
  {
    pageNo: 1,
    text: '1. The petitioner was injured on a bus.\n2. We hold that the Duty of care\n   is owed to every passenger.',
  },
  { pageNo: 2, text: '3. The appeal is allowed.' },
];

describe('verifyPinpoint', () => {
  it('verifies a quote in the cited paragraph, across case, whitespace and quote marks', async () => {
    await withTestDb(async (tx) => {
      const id = await seed(tx, NUMBERED);
      expect(await verifyPinpoint(id, { para: 2, quote: QUOTE }, { db: tx })).toEqual({
        status: 'verified',
      });
      expect(
        await verifyPinpoint(id, { para: 2, quote: `“The  DUTY of care is owed”` }, { db: tx }),
      ).toEqual({ status: 'verified' });
      expect(await verifyPinpoint(id, { para: 1, paraEnd: 2, quote: QUOTE }, { db: tx })).toEqual({
        status: 'verified',
      });
    });
  });

  it('gives a distinct reason for a wrong paragraph, an altered quote and a missing quote', async () => {
    await withTestDb(async (tx) => {
      const id = await seed(tx, NUMBERED);
      // Wrong paragraph: no paragraph 9.
      expect(await verifyPinpoint(id, { para: 9, quote: QUOTE }, { db: tx })).toEqual({
        status: 'pinpoint_not_found',
      });
      // The quote is in paragraph 2, not 3.
      expect(await verifyPinpoint(id, { para: 3, quote: QUOTE }, { db: tx })).toEqual({
        status: 'quote_not_found',
      });
      // Altered quote.
      expect(
        await verifyPinpoint(
          id,
          { para: 2, quote: 'the duty of care is owed to no passenger' },
          { db: tx },
        ),
      ).toEqual({ status: 'quote_not_found' });
      // Missing (empty) quote.
      expect(await verifyPinpoint(id, { para: 2, quote: '“”' }, { db: tx })).toEqual({
        status: 'quote_not_found',
      });
      // No such judgment.
      expect(await verifyPinpoint(randomUUID(), { para: 2 }, { db: tx })).toEqual({
        status: 'pinpoint_not_found',
      });
    });
  });

  it('falls back to the page when the text has no paragraph numbers', async () => {
    await withTestDb(async (tx) => {
      const id = await seed(tx, [
        { pageNo: 1, text: 'Heard counsel for both sides.' },
        { pageNo: 7, text: `On these facts ${QUOTE}.` },
      ]);
      expect(await verifyPinpoint(id, { page: 7, quote: QUOTE }, { db: tx })).toEqual({
        status: 'verified',
      });
      expect(await verifyPinpoint(id, { page: 1, quote: QUOTE }, { db: tx })).toEqual({
        status: 'quote_not_found',
      });
      expect(await verifyPinpoint(id, { page: 9, quote: QUOTE }, { db: tx })).toEqual({
        status: 'pinpoint_not_found',
      });
      // A paragraph pinpoint into unnumbered text, with no page, cannot be located.
      expect(await verifyPinpoint(id, { para: 2, quote: QUOTE }, { db: tx })).toEqual({
        status: 'pinpoint_not_found',
      });
    });
  });

  it('never reads page_text: no redacted text means the pinpoint is not found', async () => {
    await withTestDb(async (tx) => {
      const id = await seed(tx, null, [{ pageNo: 1, text: `1. Intro.\n2. We hold ${QUOTE}.` }]);
      const result = await verifyPinpoint(id, { para: 2, quote: QUOTE }, { db: tx });
      expect(result).toEqual({ status: 'pinpoint_not_found' });
    });
  });

  it('returns a status only, with no judgment or quote text', async () => {
    await withTestDb(async (tx) => {
      const id = await seed(tx, NUMBERED);
      const result = await verifyPinpoint(id, { para: 2, quote: QUOTE }, { db: tx });
      expect(Object.keys(result)).toEqual(['status']);
      const json = JSON.stringify(result);
      expect(json).not.toContain('passenger');
      expect(json).not.toContain('petitioner');
    });
  });
});
