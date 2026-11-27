// The lexical arm's ordering on a real database (#1187): distinct query lexemes matched come first,
// then ts_rank_cd, then id, so repeating one term or a stem collision cannot outrank broader coverage.
import { createHash, randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema } from '@causedeck/db';
import { testDatabaseUrls } from '@causedeck/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { heuristicPlan } from './plan.ts';
import { drizzleRetriever, minMatchLevels, minMatchQuery } from './retrieve.ts';

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
    // Minimum match: segments holding a single query term (1: "consent" repeated, 2: the "operator"
    // stem collision) are not candidates while segments holding two or more terms exist.
    expect(got).not.toContain(1);
    expect(got).not.toContain(2);
  });

  it('lexical arm ranks more distinct terms first, then the two-term segments', async () => {
    const got = await order('operation consent guardian');
    expect(got[0]).toBe(3);
    // 4 and 5 tie on coverage and rank; the `s.id` tie-break is a random uuid, so either order is valid.
    expect(got.slice(1, 3).sort((a, b) => a - b)).toEqual([4, 5]);
  });

  it('falls back to the plain OR when no segment holds two query terms', async () => {
    const got = await order('consent zebra yak');
    expect(got).toEqual(expect.arrayContaining([1, 3, 4, 5]));
    expect(got).not.toContain(2);
  });

  it('breaks full ties by segment id', async () => {
    const rows = await drizzleRetriever(owner, { embeddingModel: 'none' }).lexical(
      { ...heuristicPlan('guardian consent'), keywords: [] },
      50,
    );
    const tied = rows.filter((r) => r.judgmentId === judgmentId && [4, 5].includes(r.ordinal));
    expect(tied).toHaveLength(2);
    const [first, second] = tied.map((r) => r.segmentId);
    expect((first ?? '') < (second ?? '')).toBe(true);
  });
});

describe('drizzleRetriever candidates (#1172)', () => {
  const candidates = async () =>
    (
      await drizzleRetriever(owner, { embeddingModel: 'none' }).lexical(
        { ...heuristicPlan('guardian consent'), keywords: [] },
        50,
      )
    ).filter((r) => r.judgmentId === judgmentId);

  it('maps the judgment pinpoint state and attribution into every candidate', async () => {
    const before = await candidates();
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((r) => r.pinpointState === 'verified' && r.attribution === null)).toBe(true);
    const attribution = 'Dattam Labs via overthelex/indian-court-decisions, CC-BY-4.0';
    await owner.execute(
      sql`update judgment set pinpoint_state = 'pending-pdf', attribution = ${attribution} where id = ${judgmentId}`,
    );
    try {
      const after = await candidates();
      expect(after.length).toBeGreaterThan(0);
      for (const r of after) {
        expect(r.pinpointState).toBe('pending-pdf');
        expect(r.attribution).toBe(attribution);
      }
    } finally {
      await owner.execute(
        sql`update judgment set pinpoint_state = 'verified', attribution = null where id = ${judgmentId}`,
      );
    }
  });
});

describe('minMatchQuery', () => {
  it('ORs every k-term AND', () => {
    expect(minMatchQuery(['a', 'b', 'c'], 2)).toBe('(a & b) | (a & c) | (b & c)');
  });

  it('is the plain OR at k = 1 and for a single term', () => {
    expect(minMatchQuery(['a', 'b', 'c'], 1)).toBe('a | b | c');
    expect(minMatchQuery(['a'], 3)).toBe('a');
  });

  it('caps the combination pool at MIN_MATCH_TERMS and dedupes terms', () => {
    const terms = ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const q = minMatchQuery(terms, 3);
    expect(q).not.toContain('i');
    expect(q.split(' | ')).toHaveLength(56); // C(8, 3)
  });

  it('tries the strictest level first and keeps the OR as the last resort', () => {
    expect(minMatchLevels(1)).toEqual([1]);
    expect(minMatchLevels(2)).toEqual([2, 1]);
    expect(minMatchLevels(5)).toEqual([3, 2, 1]);
  });
});
