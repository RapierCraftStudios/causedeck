import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { getJudgmentForReader, getJudgmentPdfKey } from './index.ts';

const RAW = [
  { pageNo: 2, text: '4. Ramesh Kumar met Neha Sharma at the market.\n5. The appeal fails.' },
  { pageNo: 1, text: 'BETWEEN:\nRamesh Kumar ... APPELLANT\n\n1. Heard counsel.' },
];
const REDACTED = [
  { pageNo: 2, text: '4. [A] met [B] at the market.\n5. The appeal fails.' },
  { pageNo: 1, text: 'BETWEEN:\n[A] ... APPELLANT\n\n1. Heard counsel.' },
];

async function seed(
  tx: Transaction,
  over: Partial<typeof schema.judgment.$inferInsert> = {},
): Promise<string> {
  const sha256 = randomUUID().replaceAll('-', '');
  const [row] = await tx
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      neutralCitation: `2026:MHC:${String(Math.floor(Math.random() * 1e6))}`,
      bench: ['Justice A', 'Justice B'],
      judgmentDate: '2026-03-04',
      sha256,
      provenance: {
        url: 'https://open-data.example/mhc/2026.tar#2026_mhc_1.pdf',
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: RAW,
      redactedText: REDACTED,
      caseTitle: 'X v. State',
      titleMasked: true,
      ...over,
    })
    .returning({ id: schema.judgment.id });
  return row?.id ?? '';
}

describe('getJudgmentForReader', () => {
  it('returns the citable header and the redacted text per page, never page_text', async () => {
    await withTestDb(async (tx) => {
      const id = await seed(tx);
      const found = await getJudgmentForReader(id, { db: tx });
      expect(found).not.toBeNull();
      expect(found?.title).toBe('X v. State');
      expect(found?.titleMasked).toBe(true);
      expect(found?.court).toBe('MHC');
      expect(found?.judgmentDate).toBe('2026-03-04');
      expect(found?.bench).toEqual(['Justice A', 'Justice B']);
      expect(found?.neutralCitation).toMatch(/^2026:MHC:/);
      expect(found?.pages.map((p) => p.pageNo)).toEqual([1, 2]);
      expect(found?.pages[1]?.paragraphs).toEqual([
        { number: 4, text: '4. [A] met [B] at the market.' },
        { number: 5, text: '5. The appeal fails.' },
      ]);
      const served = JSON.stringify(found);
      expect(served).not.toContain('Ramesh');
      expect(served).not.toContain('Neha');
      expect(served).not.toContain('.tar');
    });
  });

  it('returns the pinpoint state and attribution of a plain-text dataset judgment (#1172)', async () => {
    await withTestDb(async (tx) => {
      const hf = await seed(tx, {
        pinpointState: 'pending-pdf',
        attribution: 'Dattam Labs via overthelex/indian-court-decisions, CC-BY-4.0',
      });
      const pending = await getJudgmentForReader(hf, { db: tx });
      expect(pending?.pinpointState).toBe('pending-pdf');
      expect(pending?.attribution).toBe('Dattam Labs via overthelex/indian-court-decisions, CC-BY-4.0');
      const verified = await getJudgmentForReader(await seed(tx), { db: tx });
      expect(verified?.pinpointState).toBe('verified');
      expect(verified?.attribution).toBeNull();
    });
  });

  it('is null when the judgment is absent or not yet redacted', async () => {
    await withTestDb(async (tx) => {
      expect(await getJudgmentForReader(randomUUID(), { db: tx })).toBeNull();
      const unredacted = await seed(tx, { redactedText: null, blobKey: 'corpus/mhc/1.pdf' });
      expect(await getJudgmentForReader(unredacted, { db: tx })).toBeNull();
      expect(await getJudgmentPdfKey(unredacted, { db: tx })).toBeNull();
    });
  });

  it('offers the stored PDF only when a blob key is set and the title is not masked', async () => {
    await withTestDb(async (tx) => {
      const none = await seed(tx, { titleMasked: false });
      expect((await getJudgmentForReader(none, { db: tx }))?.hasPdf).toBe(false);
      expect(await getJudgmentPdfKey(none, { db: tx })).toBeNull();

      const stored = await seed(tx, { titleMasked: false, blobKey: 'corpus/mhc/2.pdf' });
      expect((await getJudgmentForReader(stored, { db: tx }))?.hasPdf).toBe(true);
      expect(await getJudgmentPdfKey(stored, { db: tx })).toBe('corpus/mhc/2.pdf');

      const masked = await seed(tx, { blobKey: 'corpus/mhc/3.pdf' });
      expect((await getJudgmentForReader(masked, { db: tx }))?.hasPdf).toBe(false);
      expect(await getJudgmentPdfKey(masked, { db: tx })).toBeNull();
    });
  });
});
