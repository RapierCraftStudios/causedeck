// R17 (#896): on #891's synthetic set, hybrid retrieval (fusion, then rerank) is compared with
// lexical-only and vector-only retrieval over the same segments, on the mock embedder and reranker.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMockEmbedProvider,
  createMockRerankProvider,
  createRerankGateway,
} from '@causedeck/ai';
import { describe, expect, it } from 'vitest';

import { hybridRankers } from './hybrid-ranker.ts';
import { loadPinnedSet, MAX_NDCG_REGRESSION, runSet } from './runner.ts';

const FIXTURES = fileURLToPath(new URL('../../../../../fixtures/research-eval', import.meta.url));
const set = loadPinnedSet(path.resolve(FIXTURES));
const mock = createMockEmbedProvider();
const embed = async (texts: readonly string[]) => (await mock.embed(texts)).vectors;
const reranker = createRerankGateway({ providers: [createMockRerankProvider()] });

describe('hybrid retrieval on the synthetic set', () => {
  it('stays within the 2-point gate of the best single arm and finds every judgment', async () => {
    const rankers = await hybridRankers(set, embed, reranker);
    const lexical = runSet(rankers.lexical, set);
    const vector = runSet(rankers.vector, set);
    const fusion = runSet(rankers.fusion, set);
    const hybrid = runSet(rankers.hybrid, set);
    // The numbers recorded in the PR description. The set is saturated (12 judgments, 15 queries) and
    // the mock models are lexical, so it cannot show the gain real models give; it guards regressions.
    console.info(
      `research nDCG@10: lexical ${lexical.ndcg10.toFixed(4)}, vector ${vector.ndcg10.toFixed(4)}, fusion ${fusion.ndcg10.toFixed(4)}, fusion+rerank ${hybrid.ndcg10.toFixed(4)}; recall@50: ${hybrid.recall50.toFixed(2)}`,
    );
    const best = Math.max(lexical.ndcg10, vector.ndcg10);
    expect(hybrid.ndcg10).toBeGreaterThanOrEqual(best - MAX_NDCG_REGRESSION);
    expect(fusion.ndcg10).toBeGreaterThanOrEqual(best - MAX_NDCG_REGRESSION);
    expect(hybrid.ndcg10).toBeGreaterThan(0.9);
    expect(hybrid.recall50).toBe(1);
  });
});
