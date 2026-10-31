// An embedding ranker and the model comparison for #895 (ADR 0051 §Vectors). A judgment scores as its
// best segment's cosine similarity to the query. Vectors are computed up front (the `Ranker` contract is
// synchronous), so a candidate is any async `embed` function: the AI gateway in the model-choice run, the
// mock in CI. The BM25 baseline and `baseline.json` gate are untouched.
import { runSet, type EvalSet } from './runner.ts';
import type { EvalCorpus, EvalQuery, Ranker, SetMetrics } from './types.ts';

/** ADR 0051: default to the cheapest model within 2 nDCG@10 points of the best. */
export const NDCG_TOLERANCE = 0.02;

export type EmbedFn = (texts: readonly string[]) => Promise<number[][]>;

const dot = (a: readonly number[], b: readonly number[]): number =>
  a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);
const norm = (a: readonly number[]): number => Math.hypot(...a) || 1;
const cosine = (a: readonly number[], b: readonly number[]): number => dot(a, b) / (norm(a) * norm(b));

export async function embeddingRanker(name: string, embed: EmbedFn, set: EvalSet): Promise<Ranker> {
  const segments = set.corpus.judgments.flatMap((j) =>
    j.segments.map((s) => ({ judgmentId: j.id, text: s.text })),
  );
  const [segmentVectors, queryVectors] = await Promise.all([
    embed(segments.map((s) => s.text)),
    embed(set.queries.map((q) => q.text)),
  ]);
  const byQuery = new Map(set.queries.map((q, i) => [q.id, queryVectors[i] ?? []]));
  return {
    name,
    rank(query: EvalQuery, corpus: EvalCorpus) {
      const q = byQuery.get(query.id);
      if (q === undefined) throw new Error(`query ${query.id} was not embedded`);
      const best = new Map<string, number>();
      segments.forEach((s, i) => {
        const score = cosine(q, segmentVectors[i] ?? []);
        best.set(s.judgmentId, Math.max(best.get(s.judgmentId) ?? -Infinity, score));
      });
      return corpus.judgments
        .map((j) => ({ id: j.id, score: best.get(j.id) ?? -Infinity }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .map((j) => j.id);
    },
  };
}

export interface ModelCandidate {
  name: string;
  /** Paise per million input tokens (`EMBED_PRICES`). */
  costPaisePerMTok: number;
  embed: EmbedFn;
}

export interface ModelResult {
  name: string;
  costPaisePerMTok: number;
  metrics: SetMetrics;
}

export async function compareModels(
  set: EvalSet,
  candidates: readonly ModelCandidate[],
): Promise<ModelResult[]> {
  const results: ModelResult[] = [];
  for (const c of candidates) {
    const ranker = await embeddingRanker(c.name, c.embed, set);
    results.push({ name: c.name, costPaisePerMTok: c.costPaisePerMTok, metrics: runSet(ranker, set) });
  }
  return results;
}

/** The cheapest result within `tolerance` nDCG@10 of the best; ties go to the higher nDCG. */
export function selectModel(
  results: readonly ModelResult[],
  tolerance: number = NDCG_TOLERANCE,
): ModelResult | undefined {
  const best = Math.max(...results.map((r) => r.metrics.ndcg10));
  return results
    .filter((r) => r.metrics.ndcg10 >= best - tolerance - 1e-12)
    .sort((a, b) => a.costPaisePerMTok - b.costPaisePerMTok || b.metrics.ndcg10 - a.metrics.ndcg10)[0];
}
