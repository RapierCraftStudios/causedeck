// The lexical arm's ordering on a real database (#1187): distinct query lexemes matched come first,
// then ts_rank_cd, then id, so repeating one term or a stem collision cannot outrank broader coverage.
import { createHash, randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema } from '@causedeck/db';
import { testDatabaseUrls } from '@causedeck/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { heuristicPlan } from './plan.ts';
import { drizzleRetriever } from './retrieve.ts';

const owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
const TAG = randomUUID().slice(0, 8);
let judgmentId = '';

const seg = (ordinal: number, text: string) => ({
  judgmentId,
  ordinal,
  role: 'reasoning' as const,
  pageFrom: 1,
  pageTo: 1,
  text,
  court: 'INSC',
  courtLevel: 'supreme_court',
  judgmentYear: 2015,
});

beforeAll(async () => {
  const [j] = await owner
    .insert(schema.judgment)
    .values({
      sourceId: `test.retrieve.${TAG}`,
      court: 'INSC',
      sha256: createHash('sha256').update(TAG).digest('hex'),
      redactionVersion: 1,
      segmentedRedactionVersion: 1,
      provenance: {
        url: 'https://example.test/j.pdf',
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256: 'a'.repeat(64),
        sourceId: `test.retrieve.${TAG}`,
        sourceVersion: '1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [{ pageNo: 1, text: 'x' }],
    })
    .returning({ id: schema.judgment.id });
  judgmentId = j?.id ?? '';
  await owner.insert(schema.judgmentSegment).values([
    // 1: one term, repeated many times (highest ts_rank_cd on its own).
    seg(1, 'Consent consent consent consent consent consent consent consent consent consent.'),
    // 2: a different word sharing the stem of "operation" only.
    seg(2, 'The senior operator and the operator on duty, operator after operator.'),
    // 3: all three query terms, once each.
    seg(3, 'The operation required the consent of the guardian of the minor.'),
    // 4 and 5: identical two-term text, so only the id separates them.
    seg(4, 'Guardian consent was recorded.'),
    seg(5, 'Guardian consent was recorded.'),
  ]);
});

afterAll(async () => {
  await owner.execute(sql`delete from judgment_segment where judgment_id = ${judgmentId}`);
  await owner.execute(sql`delete from judgment where id = ${judgmentId}`);
});

const order = async (query: string): Promise<number[]> => {
  const plan = { ...heuristicPlan(query), keywords: [] as string[] };
  const rows = await drizzleRetriever(owner, { embeddingModel: 'none' }).lexical(plan, 50);
  return rows.filter((r) => r.judgmentId === judgmentId).map((r) => r.ordinal);
};

describe('drizzleRetriever.lexical ordering', () => {
  it('lexical arm ranks distinct-term coverage above single-term repetition', async () => {
    const got = await order('operation consent guardian');
    expect(got[0]).toBe(3);
    expect(got.indexOf(3)).toBeLessThan(got.indexOf(1));
  });

  it('lexical arm ranks a stem collision below more distinct terms', async () => {
    const got = await order('operation consent guardian');
    // "operator" shares the stem of "operation": one lexeme, so segment 2 trails the two-term ones.
    expect(got.indexOf(2)).toBeGreaterThan(got.indexOf(4));
    expect(got.indexOf(2)).toBeGreaterThan(got.indexOf(3));
  });

  it('breaks full ties by segment id', async () => {
    const rows = await drizzleRetriever(owner, { embeddingModel: 'none' }).lexical(
      { ...heuristicPlan('guardian consent'), keywords: [] },
      50,
    );
    const tied = rows.filter((r) => r.judgmentId === judgmentId && [4, 5].includes(r.ordinal));
    expect(tied).toHaveLength(2);
    expect(tied[0]?.segmentId < (tied[1]?.segmentId ?? '')).toBe(true);
  });
});
