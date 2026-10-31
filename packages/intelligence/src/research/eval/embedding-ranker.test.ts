import { createMockEmbedProvider } from '@causedeck/ai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compareModels, embeddingRanker, selectModel, type ModelResult } from './embedding-ranker.ts';
import { loadPinnedSet } from './runner.ts';

const FIXTURES = fileURLToPath(new URL('../../../../../fixtures/research-eval', import.meta.url));
const set = loadPinnedSet(path.resolve(FIXTURES));
const mock = createMockEmbedProvider();
const embed = async (texts: readonly string[]) => (await mock.embed(texts)).vectors;

describe('embedding ranker', () => {
  it('ranks every judgment and scores the synthetic set', async () => {
    const ranker = await embeddingRanker('mock', embed, set);
    const q = set.queries[0];
    if (!q) throw new Error('no queries');
    expect(ranker.rank(q, set.corpus)).toHaveLength(set.corpus.judgments.length);
    const [result] = await compareModels(set, [{ name: 'mock', costPaisePerMTok: 0, embed }]);
    expect(result?.metrics.queries).toBe(set.queries.length);
    expect(result?.metrics.ndcg10).toBeGreaterThan(0);
    expect(result?.metrics.recall50).toBeGreaterThan(0);
  });
});

describe('selectModel', () => {
  const r = (name: string, ndcg10: number, cost: number): ModelResult => ({
    name,
    costPaisePerMTok: cost,
    metrics: { queries: 1, ndcg10, recall50: 1, quoteFaithfulness: null, citationFaithfulness: null, perQuery: [] },
  });
  it('picks the cheapest model within 2 nDCG@10 points of the best', () => {
    const picked = selectModel([r('best', 0.8, 840), r('close', 0.79, 168), r('far', 0.7, 0)]);
    expect(picked?.name).toBe('close');
  });
  it('keeps the best when the cheaper one is more than 2 points behind', () => {
    expect(selectModel([r('best', 0.8, 840), r('cheap', 0.77, 168)])?.name).toBe('best');
  });
});
