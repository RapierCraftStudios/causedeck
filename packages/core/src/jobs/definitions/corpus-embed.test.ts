// `system.corpus.embed` (#895): a backfill embeds only the four roles, a second run with the same model
// version makes no provider call, a new version re-embeds, and the per-run budget stops the run and the
// next run resumes. Real database, the mock provider.
import { randomUUID } from 'node:crypto';

import { createMockEmbedProvider } from '@causedeck/ai';
import { schema, type Queryable } from '@causedeck/db';
import { closeTestDb, withTestDb } from '@causedeck/db/testing';
import { eq, isNotNull } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { corpusEmbed, runCorpusEmbed } from './corpus-embed.ts';

afterAll(async () => {
  await closeTestDb();
});

const ctx = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as never;
const ROLES = ['header', 'facts', 'issues', 'reasoning', 'decision', 'other'] as const;

async function seed(db: Queryable): Promise<string> {
  const sha256 = randomUUID().replaceAll('-', '');
  const [row] = await db
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      provenance: {
        url: 'https://mhc.example/j/e.pdf',
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [{ pageNo: 1, text: 'x' }],
    })
    .returning({ id: schema.judgment.id });
  const judgmentId = row?.id ?? '';
  await db.insert(schema.judgmentSegment).values(
    ROLES.map((role, i) => ({
      judgmentId,
      ordinal: i + 1,
      role,
      pageFrom: 1,
      pageTo: 1,
      text: `The ${role} paragraph of the fixture.`,
      court: 'MHC',
      courtLevel: 'high_court',
      judgmentYear: 2019,
    })),
  );
  return judgmentId;
}

const embeddedRows = (db: Queryable, judgmentId: string) =>
  db
    .select({ role: schema.judgmentSegment.role, model: schema.judgmentSegment.embeddingModel })
    .from(schema.judgmentSegment)
    .where(eq(schema.judgmentSegment.judgmentId, judgmentId))
    .then((rows) => rows.filter((r) => r.model !== null));

describe('runCorpusEmbed', () => {
  it('backfills the four roles, is a no-op for the same version and re-embeds for a new one', async () => {
    await withTestDb(async (db) => {
      const id = await seed(db);
      const v1 = createMockEmbedProvider({ version: '1' });
      const first = await runCorpusEmbed(ctx, { workspaceId: null }, { db, provider: v1 });
      expect(first.embedded).toBe(4);
      expect(first.remaining).toBe(false);
      const rows = await embeddedRows(db, id);
      expect(rows.map((r) => r.role).sort()).toEqual(['decision', 'facts', 'issues', 'reasoning']);
      expect(rows.every((r) => r.model === 'mock-embed@1')).toBe(true);

      const spy = vi.spyOn(v1, 'embed');
      expect((await runCorpusEmbed(ctx, {}, { db, provider: v1 })).embedded).toBe(0);
      expect(spy).not.toHaveBeenCalled();

      const v2 = createMockEmbedProvider({ version: '2' });
      expect((await runCorpusEmbed(ctx, {}, { db, provider: v2 })).embedded).toBe(4);
      expect((await embeddedRows(db, id)).every((r) => r.model === 'mock-embed@2')).toBe(true);
    });
  });

  it('stops at the segment cap and resumes on the next run', async () => {
    await withTestDb(async (db) => {
      const id = await seed(db);
      const provider = createMockEmbedProvider();
      const first = await runCorpusEmbed(ctx, { maxSegments: 2 }, { db, provider, batchSize: 1 });
      expect(first).toMatchObject({ embedded: 2, remaining: true });
      const second = await runCorpusEmbed(ctx, {}, { db, provider });
      expect(second).toMatchObject({ embedded: 2, remaining: false });
      expect(await embeddedRows(db, id)).toHaveLength(4);
      const vectors = await db
        .select({ id: schema.judgmentSegment.id })
        .from(schema.judgmentSegment)
        .where(isNotNull(schema.judgmentSegment.embedding));
      expect(vectors.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('is a scheduled singleton job', () => {
    expect(corpusEmbed.name).toBe('system.corpus.embed');
    expect(corpusEmbed.concurrency).toBe(1);
  });
});
