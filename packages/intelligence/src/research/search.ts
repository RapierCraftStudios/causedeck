// The search pipeline (#896, ADR 0051 §Query pipeline): plan -> lexical and vector retrieval ->
// fusion -> rerank -> group, with an optional verified answer. Every collaborator is a port (the
// retriever, the embed and rerank gateways, the planner and answer models), so the pipeline is a pure
// composition: the core service wires the SQL retriever and the gateways, tests and the evaluation
// harness wire in-memory ones. Editing a filter chip calls `searchCorpusWithPlan` with the edited plan and
// never plans again.
import type { EmbedGateway, RerankGateway } from '@causedeck/ai';

import { answerQuery, type AnswerResolver, type ResearchAnswer } from './answer.ts';
import { fuseArms, groupByJudgment, rerankCandidates } from './fuse.ts';
import { planQuery, type PlanResolver } from './plan.ts';
import { ARM_LIMIT } from './retrieve.ts';
import type { ResearchPlan, SearchHit, SegmentRetriever } from './types.ts';

export interface SearchDeps {
  retriever: SegmentRetriever;
  embed: Pick<EmbedGateway, 'embed'>;
  rerank: Pick<RerankGateway, 'rerank'>;
  /** Planner model; without one the rule-based plan is used. */
  plan?: PlanResolver;
  /** Answer model; required only for `answer: true`. */
  answer?: AnswerResolver;
}

export interface SearchOptions {
  /** Also produce a verified answer (a model call over the hits). */
  answer?: boolean;
  armLimit?: number;
}

export interface SearchCounts {
  lexical: number;
  vector: number;
  fused: number;
  reranked: boolean;
}

export interface SearchResult {
  plan: ResearchPlan;
  hits: SearchHit[];
  counts: SearchCounts;
  /** Paise the embed and rerank calls cost (the planner and answer calls are metered by the gateway). */
  costPaise: number;
  answer: ResearchAnswer | null;
  /** Set when an answer was asked for and the model call failed; `hits` are still valid. */
  answerFailed: boolean;
}

/** Plans `query` and searches with the plan. */
export async function searchCorpus(
  deps: SearchDeps,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  return searchCorpusWithPlan(deps, await planQuery(query, deps.plan), options);
}

/** Searches with an already planned (possibly edited) plan; never calls the planner. */
export async function searchCorpusWithPlan(
  deps: SearchDeps,
  plan: ResearchPlan,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const limit = options.armLimit ?? ARM_LIMIT;
  const embedded = await deps.embed.embed([plan.factDescription || plan.query]);
  const [lexical, vector] = await Promise.all([
    deps.retriever.lexical(plan, limit),
    deps.retriever.vector(embedded.vectors[0] ?? [], plan, limit),
  ]);
  const fused = fuseArms([lexical, vector]);
  const outcome = await rerankCandidates(plan.factDescription || plan.query, fused, deps.rerank);
  const hits = groupByJudgment(outcome.candidates);

  let answer: ResearchAnswer | null = null;
  let answerFailed = false;
  if (options.answer === true) {
    try {
      answer = deps.answer === undefined ? null : await answerQuery(plan.query, hits, deps.answer);
      answerFailed = deps.answer === undefined;
    } catch {
      answerFailed = true;
    }
  }
  return {
    plan,
    hits,
    counts: {
      lexical: lexical.length,
      vector: vector.length,
      fused: fused.length,
      reranked: outcome.reranked,
    },
    costPaise: embedded.costPaise + outcome.costPaise,
    answer,
    answerFailed,
  };
}
