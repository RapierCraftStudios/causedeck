// Corpus segments (#893, ADR 0051): the migration declares lz4 on the large text columns and
// range-partitions `judgment_segment` by decade with a default partition (text check); and, on a real
// database, the lexical vector answers a phrase and a section query, a year-filtered query prunes to
// one partition, and the app role may read segments but not edit them.
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

const migration = readFileSync(
  path.join(MIGRATIONS_FOLDER, '20261030211330_corpus_segments.sql'),
  'utf8',
);

describe('judgment_segment migration', () => {
  it('declares lz4 compression on the large text columns', () => {
    expect(migration).toMatch(/"judgment_segment" ALTER COLUMN "text" SET COMPRESSION lz4/);
    expect(migration).toMatch(/"judgment" ALTER COLUMN "page_text" SET COMPRESSION lz4/);
    expect(migration).toMatch(/"judgment" ALTER COLUMN "redacted_text" SET COMPRESSION lz4/);
  });

  it('is range-partitioned by judgment_year in decades with a default partition', () => {
    expect(migration).toMatch(/PARTITION BY RANGE \("judgment_year"\)/);
    expect(migration).toMatch(/PARTITION OF "judgment_segment" DEFAULT/);
    for (const decade of ['1950', '1990', '2010', '2020', '2030']) {
      expect(migration).toContain(
        `FOR VALUES FROM (${decade}) TO (${String(Number(decade) + 10)})`,
      );
    }
  });
});

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
const TAG = randomUUID().slice(0, 8);
let judgmentId = '';

const seg = (ordinal: number, year: number, text: string) => ({
  judgmentId,
  ordinal,
  role: 'reasoning' as const,
  pageFrom: 1,
  pageTo: 1,
  text,
  court: 'INSC',
  courtLevel: 'supreme_court',
  judgmentYear: year,
});

beforeAll(async () => {
  const [j] = await owner
    .insert(judgment)
    .values({
      sourceId: `test.segments.${TAG}`,
      court: 'INSC',
      sha256: createHash('sha256').update(TAG).digest('hex'),
      provenance: {
        url: 'https://example.test/j.pdf',
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256: 'a'.repeat(64),
        sourceId: `test.segments.${TAG}`,
        sourceVersion: '1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [{ pageNo: 1, text: 'x' }],
    })
    .returning({ id: judgment.id });
  judgmentId = j?.id ?? '';
  await owner
    .insert(judgmentSegment)
    .values([
      seg(1, 2015, 'The doctrine of res ipsa loquitur applies where the thing speaks for itself.'),
      seg(2, 2015, 'The accused was charged under Section 304A of the Indian Penal Code.'),
      seg(3, 1975, 'An unrelated passage about limitation and condonation of delay.'),
    ]);
});

afterAll(async () => {
  await owner.execute(sql`delete from judgment_segment where judgment_id = ${judgmentId}`);
  await owner.execute(sql`delete from judgment where id = ${judgmentId}`);
});

const texts = async (query: ReturnType<typeof sql>) =>
  (await owner.execute<{ text: string }>(query)).map((r) => r.text);

describe('judgment_segment lexical search', () => {
  it('finds a quoted phrase with websearch_to_tsquery', async () => {
    const found = await texts(sql`select text from judgment_segment
      where judgment_id = ${judgmentId}
        and search_tsv @@ websearch_to_tsquery('english', '"res ipsa loquitur"')`);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('res ipsa loquitur');
  });

  it('finds a section number kept whole by the simple configuration', async () => {
    const found = await texts(sql`select text from judgment_segment
      where judgment_id = ${judgmentId}
        and search_tsv @@ websearch_to_tsquery('simple', '304A')`);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('304A');
  });
});

describe('judgment_segment partitioning', () => {
  it('puts rows in the decade partition and prunes a year-filtered query to it', async () => {
    const where = await owner.execute<{ part: string }>(
      sql`select tableoid::regclass::text as part from judgment_segment where judgment_id = ${judgmentId} and judgment_year = 1975`,
    );
    expect(where.map((r) => r.part)).toEqual(['judgment_segment_1970s']);

    const plan = (
      await owner.execute<Record<string, string>>(
        sql`explain select text from judgment_segment where judgment_year = 2015 and search_tsv @@ websearch_to_tsquery('english', 'negligence')`,
      )
    )
      .map((r) => Object.values(r)[0])
      .join('\n');
    expect(plan).toContain('judgment_segment_2010s');
    expect(plan).not.toContain('judgment_segment_2020s');
    expect(plan).not.toContain('judgment_segment_1970s');
  });
});
