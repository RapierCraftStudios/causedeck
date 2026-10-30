// Runs a Ranker over an evaluation set and compares the result with the committed baseline.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { checkAnswer } from './faithfulness.ts';
import { manifestDrift, type Manifest } from './manifest.ts';
import { mean, ndcgAtK, recallAtK } from './metrics.ts';
import {
  corpusSchema,
  queriesSchema,
  type EvalCorpus,
  type EvalQuery,
  type Ranker,
  type SetMetrics,
} from './types.ts';

/** ADR 0051: a regression of more than 2 nDCG points fails the eval job. */
export const MAX_NDCG_REGRESSION = 0.02;

export interface EvalSet {
  corpus: EvalCorpus;
  queries: EvalQuery[];
}

export interface EvalReport {
  ranker: string;
  synthetic: SetMetrics;
  /** The private set (RESEARCH_EVAL_PRIVATE_DIR), reported separately and never gated. */
  private: SetMetrics | null;
}

export function loadEvalSet(dir: string): EvalSet {
  const read = (file: string): unknown => JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  const corpus = corpusSchema.parse(read('corpus.json'));
  const { queries } = queriesSchema.parse(read('queries.json'));
  const ids = new Set(corpus.judgments.map((j) => j.id));
  for (const q of queries) {
    for (const id of Object.keys(q.judgments)) {
      if (!ids.has(id)) throw new Error(`query ${q.id} judges unknown judgment ${id}`);
    }
  }
  return { corpus, queries };
}

/** Loads the set and refuses it when a file no longer matches the pinned manifest. */
export function loadPinnedSet(dir: string): EvalSet {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
  const drift = manifestDrift(dir, manifest);
  if (drift.length > 0) throw new Error(`eval set drifted from manifest.json: ${drift.join('; ')}`);
  return loadEvalSet(dir);
}

export function runSet(ranker: Ranker, set: EvalSet): SetMetrics {
  const perQuery = [];
  const totals = { quotes: 0, quotesMatching: 0, citations: 0, citationsExisting: 0 };
  for (const query of set.queries) {
    const ranked = ranker.rank(query, set.corpus);
    perQuery.push({
      id: query.id,
      ndcg10: ndcgAtK(ranked, query.judgments),
      recall50: recallAtK(ranked, query.judgments),
    });
    if (ranker.answer !== undefined) {
      const f = checkAnswer(ranker.answer(query, set.corpus, ranked), set.corpus);
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += f[key];
    }
  }
  const rate = (n: number, d: number): number | null => (d === 0 ? null : n / d);
  return {
    queries: perQuery.length,
    ndcg10: mean(perQuery.map((q) => q.ndcg10)),
    recall50: mean(perQuery.map((q) => q.recall50)),
    quoteFaithfulness: rate(totals.quotesMatching, totals.quotes),
    citationFaithfulness: rate(totals.citationsExisting, totals.citations),
    perQuery,
  };
}

export function runEval(ranker: Ranker, syntheticDir: string, privateDir?: string): EvalReport {
  const hasPrivate = privateDir !== undefined && privateDir !== '' && existsSync(privateDir);
  return {
    ranker: ranker.name,
    synthetic: runSet(ranker, loadPinnedSet(syntheticDir)),
    private: hasPrivate ? runSet(ranker, loadEvalSet(privateDir)) : null,
  };
}

export interface Comparison {
  baselineNdcg10: number;
  ndcg10: number;
  drop: number;
  regressed: boolean;
}

/** Fails (regressed) when nDCG@10 fell by more than 2 points against the baseline. */
export function compareToBaseline(current: SetMetrics, baseline: { ndcg10: number }): Comparison {
  const drop = baseline.ndcg10 - current.ndcg10;
  return {
    baselineNdcg10: baseline.ndcg10,
    ndcg10: current.ndcg10,
    drop,
    regressed: drop > MAX_NDCG_REGRESSION + 1e-9,
  };
}
