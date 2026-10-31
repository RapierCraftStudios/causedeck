// Research over the judgments corpus (ADR 0051): the retrieval evaluation harness.
export { bm25Ranker } from './eval/baseline-ranker.ts';
export {
  compareModels,
  embeddingRanker,
  NDCG_TOLERANCE,
  selectModel,
  type EmbedFn,
  type ModelCandidate,
  type ModelResult,
} from './eval/embedding-ranker.ts';
export { checkAnswer } from './eval/faithfulness.ts';
export { ndcgAtK, recallAtK } from './eval/metrics.ts';
export {
  compareToBaseline,
  loadEvalSet,
  loadPinnedSet,
  MAX_NDCG_REGRESSION,
  runEval,
  runSet,
  type EvalReport,
  type EvalSet,
} from './eval/runner.ts';
export type { Answer, EvalCorpus, EvalQuery, Ranker, SetMetrics } from './eval/types.ts';
