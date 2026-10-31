// The search pipeline as `Ranker`s over an evaluation set (#896, ADR 0051 §Evaluation): lexical-only,
// vector-only and the hybrid (fusion plus rerank), all over the same segments, so the hybrid's gain is
// measured on #891's set. Retrieval is in memory (BM25 over segments, cosine over their vectors) and the
// plan's facet filters are not applied: the synthetic corpus carries no enrichment rows. Vectors and
// rerank scores are computed up front because `Ranker.rank` is synchronous.
import type { RerankGateway } from '@causedeck/ai';

import { fuseArms, groupByJudgment, rerankCandidates } from '../fuse.ts';
import { heuristicPlan } from '../plan.ts';
import type { FusedCandidate, SegmentCandidate } from '../types.ts';
import { tokenize } from './baseline-ranker.ts';
import type { EmbedFn } from './embedding-ranker.ts';
import type { EvalSet } from './runner.ts';
import type { EvalQuery, Ranker } from './types.ts';

const K1 = 1.2;
const B = 0.75;
const ARM = 200;

const cosine = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((x, i) => {
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  });
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

export interface HybridRankers {
  lexical: Ranker;
  vector: Ranker;
  /** Fusion of the two arms without the reranker. */
  fusion: Ranker;
  /** Fusion and rerank: the pipeline of ADR 0051. */
  hybrid: Ranker;
}

export async function hybridRankers(
  set: EvalSet,
  embed: EmbedFn,
  reranker: Pick<RerankGateway, 'rerank'>,
): Promise<HybridRankers> {
  const segments: SegmentCandidate[] = set.corpus.judgments.flatMap((j) =>
    j.segments.map((s, i) => ({
      segmentId: s.id,
      judgmentId: j.id,
      judgmentYear: 2020,
      ordinal: i + 1,
      role: 'reasoning' as const,
      pageFrom: s.page,
      pageTo: s.page,
      text: s.text,
      court: j.court,
      courtLevel: 'high_court',
      title: j.title,
      titleMasked: false,
      neutralCitation: null,
      judgmentDate: null,
      outcome: 'unknown' as const,
      citedByCount: 0,
      sourceUrl: null,
    })),
  );
  const tokens = segments.map((s) => tokenize(s.text));
  const avg = tokens.reduce((n, t) => n + t.length, 0) / tokens.length;
  const df = new Map<string, number>();
  for (const t of tokens) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);

  const lexical = (text: string): SegmentCandidate[] => {
    const terms = [...new Set(tokenize(text))];
    return segments
      .map((segment, i) => {
        const tf = new Map<string, number>();
        for (const w of tokens[i] ?? []) tf.set(w, (tf.get(w) ?? 0) + 1);
        let score = 0;
        for (const w of terms) {
          const f = tf.get(w) ?? 0;
          if (f === 0) continue;
          const n = df.get(w) ?? 0;
          const idf = Math.log(1 + (segments.length - n + 0.5) / (n + 0.5));
          score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * (tokens[i]?.length ?? 0)) / avg));
        }
        return { segment, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.segment.segmentId.localeCompare(b.segment.segmentId))
      .slice(0, ARM)
      .map((x) => x.segment);
  };

  const [segmentVectors, queryVectors] = await Promise.all([
    embed(segments.map((s) => s.text)),
    embed(set.queries.map((q) => q.text)),
  ]);
  const vector = (queryIndex: number): SegmentCandidate[] =>
    segments
      .map((segment, i) => ({
        segment,
        score: cosine(queryVectors[queryIndex] ?? [], segmentVectors[i] ?? []),
      }))
      .sort((a, b) => b.score - a.score || a.segment.segmentId.localeCompare(b.segment.segmentId))
      .slice(0, ARM)
      .map((x) => x.segment);

  const asFused = (list: SegmentCandidate[]): FusedCandidate[] =>
    list.map((c, i) => ({ ...c, fusedScore: 1 / (60 + i + 1), rerankScore: null }));
  const allIds = set.corpus.judgments.map((j) => j.id);
  const complete = (ranked: string[]): string[] => [
    ...ranked,
    ...allIds.filter((id) => !ranked.includes(id)),
  ];
  const judgments = (list: FusedCandidate[]): string[] =>
    complete(groupByJudgment(list, allIds.length).map((h) => h.judgmentId));

  const lexicalRanked = new Map<string, string[]>();
  const vectorRanked = new Map<string, string[]>();
  const fusionRanked = new Map<string, string[]>();
  const hybridRanked = new Map<string, string[]>();
  for (const [i, query] of set.queries.entries()) {
    const lex = lexical(query.text);
    const vec = vector(i);
    lexicalRanked.set(query.id, judgments(asFused(lex)));
    vectorRanked.set(query.id, judgments(asFused(vec)));
    const fused = fuseArms([lex, vec]);
    fusionRanked.set(query.id, judgments(fused));
    const plan = heuristicPlan(query.text);
    const outcome = await rerankCandidates(plan.factDescription, fused, reranker);
    hybridRanked.set(query.id, judgments(outcome.candidates));
  }
  const ranker = (name: string, ranked: Map<string, string[]>): Ranker => ({
    name,
    rank: (query: EvalQuery) => ranked.get(query.id) ?? allIds,
  });
  return {
    lexical: ranker('segment-bm25', lexicalRanked),
    vector: ranker('segment-vector', vectorRanked),
    fusion: ranker('hybrid-fusion', fusionRanked),
    hybrid: ranker('hybrid-rerank', hybridRanked),
  };
}
