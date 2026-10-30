// `system.corpus.redact` (#892): rows below REDACTION_VERSION are re-redacted from page_text with no
// fetch, a current row is left alone, and the raw text and sha256 never change.
import { randomUUID } from 'node:crypto';

import { schema, type Queryable } from '@causedeck/db';
import { closeTestDb, withTestDb } from '@causedeck/db/testing';
import { REDACTION_VERSION } from '@causedeck/intelligence';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { runCorpusRedact } from './corpus-redact.ts';

afterAll(async () => {
  await closeTestDb();
});

const PAGES = [
  { pageNo: 1, text: 'BETWEEN:\nRamesh Kumar ... APPELLANT\nAND:\nSuresh Babu ... RESPONDENT' },
  { pageNo: 2, text: 'The appellant Ramesh Kumar was tried.' },
];

const ctx = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as never;

async function insert(db: Queryable, redactionVersion: number): Promise<{ id: string; sha256: string }> {
  const sha256 = randomUUID().replaceAll('-', '');
  const [row] = await db
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      provenance: {
        url: 'https://mhc.example/j/r.pdf',
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: PAGES,
      redactionVersion,
    })
    .returning({ id: schema.judgment.id });
  return { id: row!.id, sha256 };
}

describe('runCorpusRedact', () => {
  it('re-redacts stale rows from page_text and leaves current rows and raw text alone', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never as Queryable;
      const stale = await insert(db, REDACTION_VERSION - 1);
      const current = await insert(db, REDACTION_VERSION);
      const report = await runCorpusRedact(ctx, { batch: 500 }, { db });
      expect(report.redacted).toBeGreaterThanOrEqual(1);

      const [s] = await tx.select().from(schema.judgment).where(eq(schema.judgment.id, stale.id));
      expect(s?.redactionVersion).toBe(REDACTION_VERSION);
      expect((s?.redactedText ?? []).map((p) => p.text).join('\n')).not.toMatch(/Ramesh|Suresh/);
      expect(s?.pageText).toEqual(PAGES);
      expect(s?.sha256).toBe(stale.sha256);

      const [c] = await tx.select().from(schema.judgment).where(eq(schema.judgment.id, current.id));
      expect(c?.redactedText).toBeNull();
    });
  });
});
