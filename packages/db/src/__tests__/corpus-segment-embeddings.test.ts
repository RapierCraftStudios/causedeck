// Segment embeddings (#895, ADR 0051 §Vectors): the migration builds a halfvec HNSW index per
// partition (halfvec_cosine_ops, m=16, ef_construction=64) and the app role may update only the two
// embedding columns; on a real database a court- and year-filtered vector query with
// `hnsw.iterative_scan = relaxed_order` still returns a full top-k.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../migrate.ts';
import { createOwnerDb } from '../owner.ts';
import { judgment, judgmentSegment } from '../schema/corpus.ts';
import { testDatabaseUrls } from '../testing/index.ts';
import { CORPUS_EMBEDDING_DIMENSIONS } from '../vector.ts';

const PARTITIONS = [
  'pre1950',
  '1950s',
  '1960s',
  '1970s',
  '1980s',
  '1990s',
  '2000s',
  '2010s',
  '2020s',
  '2030s',
  'default',
];

const migration = readFileSync(
  path.join(MIGRATIONS_FOLDER, '20261031001315_corpus_segment_embeddings.sql'),
  'utf8',
);

describe('segment embedding migration', () => {
  it('adds the model version column and an HNSW index per partition', () => {
    expect(migration).toContain('ADD COLUMN "embedding_model" text');
    for (const part of PARTITIONS) {
      expect(migration).toMatch(
        new RegExp(
          `ON "judgment_segment_${part}" USING hnsw \\("embedding" halfvec_cosine_ops\\) WITH \\(m = 16, ef_construction = 64\\)`,
        ),
      );
    }
  });
});

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
const TAG = randomUUID().slice(0, 8);
let judgmentId = '';

/** A unit-ish vector pointing mostly along axis `i`, with a small `skew`. */
const vec = (i: number, skew: number): string => {
  const v = new Array<number>(CORPUS_EMBEDDING_DIMENSIONS).fill(0);
  v[i % CORPUS_EMBEDDING_DIMENSIONS] = 1;
  v[(i + 1) % CORPUS_EMBEDDING_DIMENSIONS] = skew;
  return `[${v.join(',')}]`;
};

beforeAll(async () => {
  const [j] = await owner
    .insert(judgment)
    .values({
      sourceId: `test.embeddings.${TAG}`,
      court: 'INSC',
      sha256: createHash('sha256').update(TAG).digest('hex'),
      provenance: {
        url: 'https://example.test/j.pdf',
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256: 'a'.repeat(64),
        sourceId: `test.embeddings.${TAG}`,
        sourceVersion: '1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [{ pageNo: 1, text: 'x' }],
    })
    .returning({ id: judgment.id });
  judgmentId = j?.id ?? '';
  // 60 segments in 2015: the first 30 are the INSC ones, the rest MADHC; all near the query.
  await owner.insert(judgmentSegment).values(
    Array.from({ length: 60 }, (_, n) => ({
      judgmentId,
      ordinal: n + 1,
      role: 'facts' as const,
      pageFrom: 1,
      pageTo: 1,
      text: `Segment ${String(n)} of the embedding fixture.`,
      court: n < 30 ? 'INSC' : 'MADHC',
      courtLevel: n < 30 ? 'supreme_court' : 'high_court',
      judgmentYear: 2015,
    })),
  );
  await owner.execute(sql`update judgment_segment
    set embedding = ('[' || array_to_string(array_fill(0::float4, array[${CORPUS_EMBEDDING_DIMENSIONS}]) , ',') || ']')::halfvec,
        embedding_model = 'test-model@1'
    where judgment_id = ${judgmentId}`);
  for (let n = 1; n <= 60; n += 1) {
    await owner.execute(sql`update judgment_segment
      set embedding = ${vec(0, n / 100)}::halfvec
      where judgment_id = ${judgmentId} and ordinal = ${n}`);
  }
});

afterAll(async () => {
  await owner.execute(sql`delete from judgment_segment where judgment_id = ${judgmentId}`);
  await owner.execute(sql`delete from judgment where id = ${judgmentId}`);
});

describe('judgment_segment HNSW indexes', () => {
  it('exists on every partition with the declared opclass and options', async () => {
    const rows = await owner.execute<{ def: string }>(
      sql`select indexdef as def from pg_indexes where indexname like 'judgment_segment_%_embedding_hnsw_idx'`,
    );
    expect(rows).toHaveLength(PARTITIONS.length);
    for (const r of rows) {
      expect(r.def).toContain('USING hnsw');
      expect(r.def).toContain('halfvec_cosine_ops');
      expect(r.def).toMatch(/m='?16'?/);
      expect(r.def).toMatch(/ef_construction='?64'?/);
    }
  });
});

describe('filtered vector search', () => {
  it('returns a full top-k for a court and year filter with relaxed_order iterative scan', async () => {
    const k = 20;
    const rows = await owner.transaction(async (tx) => {
      await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
      await tx.execute(sql`set local enable_seqscan = off`);
      return tx.execute<{ id: string }>(sql`select id from judgment_segment
        where court = 'MADHC' and judgment_year = 2015 and judgment_id = ${judgmentId}
        order by embedding <=> ${vec(0, 0.5)}::halfvec
        limit ${k}`);
    });
    expect(rows).toHaveLength(k);
  });

  it('plans the year-filtered query on the decade partition index', async () => {
    const plan = (
      await owner.transaction(async (tx) => {
        await tx.execute(sql`set local enable_seqscan = off`);
        return tx.execute<Record<string, string>>(sql`explain select id from judgment_segment
          where judgment_year = 2015 order by embedding <=> ${vec(0, 0.5)}::halfvec limit 5`);
      })
    )
      .map((r) => Object.values(r)[0])
      .join('\n');
    expect(plan).toContain('judgment_segment_2010s_embedding_hnsw_idx');
    expect(plan).not.toContain('judgment_segment_2020s');
  });
});
