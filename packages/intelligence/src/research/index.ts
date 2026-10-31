// Research over the judgments corpus (ADR 0051): the fact-pattern search pipeline (#896: plan, lexical
// and vector retrieval, fusion, rerank, group, verified answer) and the retrieval evaluation harness.
export {
  answerQuery,
  ANSWER_SEGMENTS,
  createGatewayAnswerResolver,
  type AnswerClaim,
  type AnswerInput,
  type AnswerResolver,
  type ResearchAnswer,
} from './answer.ts';
export {
  candidateBoost,
  CITED_BY_WEIGHT,
  COURT_LEVEL_BOOST,
  fuseArms,
  groupByJudgment,
  RERANK_TOP,
  rerankCandidates,
  RESULT_JUDGMENTS,
  RRF_K,
  SEGMENT_CHARS,
  SEGMENTS_PER_JUDGMENT,
  type RerankOutcome,
} from './fuse.ts';
export {
  createGatewayPlanResolver,
  expandedStatutes,
  heuristicPlan,
  normalisePlan,
  PLAN_VERSION,
  planQuery,
  validatePlan,
  searchTerms,
  statuteChips,
  type GatewayPlanOptions,
  type PlanResolver,
  type StatuteChip,
} from './plan.ts';
export {
  ARM_LIMIT,
  drizzleRetriever,
  planFilters,
  type DrizzleRetrieverOptions,
} from './retrieve.ts';
export {
  searchCorpus,
  searchCorpusWithPlan,
  type SearchCounts,
  type SearchDeps,
  type SearchOptions,
  type SearchResult,
} from './search.ts';
export type {
  CourtLevel,
  FusedCandidate,
  RankedCandidates,
  ResearchPlan,
  SearchHit,
  SearchSegment,
  SegmentCandidate,
  SegmentRetriever,
} from './types.ts';
// The retrieval evaluation harness (#891).
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
