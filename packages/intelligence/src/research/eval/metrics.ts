// Retrieval metrics over graded judgments. Gain is 2^grade - 1 with a log2 rank discount.
export const NDCG_K = 10;
export const RECALL_K = 50;

type Grades = Record<string, number>;

function dcg(grades: number[]): number {
  return grades.reduce((sum, g, i) => sum + (2 ** g - 1) / Math.log2(i + 2), 0);
}

/** nDCG@k of `ranked` against `judged`; 0 when nothing is relevant. Duplicate ids count once. */
export function ndcgAtK(ranked: readonly string[], judged: Grades, k: number = NDCG_K): number {
  const top = [...new Set(ranked)].slice(0, k).map((id) => judged[id] ?? 0);
  const ideal = Object.values(judged)
    .sort((a, b) => b - a)
    .slice(0, k);
  const best = dcg(ideal);
  return best === 0 ? 0 : dcg(top) / best;
}

/** Share of judgments with grade >= 1 that appear in the top k; 0 when nothing is relevant. */
export function recallAtK(ranked: readonly string[], judged: Grades, k: number = RECALL_K): number {
  const relevant = Object.entries(judged).filter(([, g]) => g >= 1);
  if (relevant.length === 0) return 0;
  const top = new Set(ranked.slice(0, k));
  return relevant.filter(([id]) => top.has(id)).length / relevant.length;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}
