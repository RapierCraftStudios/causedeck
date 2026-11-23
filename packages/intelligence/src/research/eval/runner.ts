// Runs a Ranker over an evaluation set and compares the result with the committed baseline.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { RerankGateway } from '@causedeck/ai';

import { loadAnswers, runAnswerEval } from './answer-eval.ts';
import { bm25Ranker } from './baseline-ranker.ts';
import type { EmbedFn } from './embedding-ranker.ts';
import { checkAnswer } from './faithfulness.ts';
import { hybridRankers } from './hybrid-ranker.ts';
import { buildManifest, manifestDrift, type Manifest } from './manifest.ts';
import { mean, ndcgAtK, recallAtK } from './metrics.ts';
import {
  corpusSchema,
  QUALITY_METRICS,
  queriesSchema,
  type AnswerMetrics,
  type EvalCorpus,
  type EvalQuery,
  type QualityBaseline,
  type QualityMetric,
  type QualityMetrics,
  type QualityThresholds,
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

// The copilot quality report and gate (#1119): retrieval (BM25 and hybrid) plus the answer metrics.

/** Bumped when report.json changes shape incompatibly. */
export const QUALITY_SCHEMA_VERSION = 1;

export interface QualitySetReport {
  metrics: QualityMetrics;
  /** Null when the set has no answers.json. */
  answers: AnswerMetrics | null;
  perQuery: { id: string; ndcg10: number; ndcg10Hybrid: number; recall50: number }[];
}

export interface QualityReport {
  schemaVersion: typeof QUALITY_SCHEMA_VERSION;
  rankers: { baseline: string; hybrid: string };
  synthetic: QualitySetReport;
  /** The private set (RESEARCH_EVAL_PRIVATE_DIR), reported separately and never gated. */
  private: QualitySetReport | null;
}

export interface QualityOptions {
  syntheticDir: string;
  privateDir?: string | undefined;
  /** Deterministic in CI: the mock embedder and reranker of @causedeck/ai. */
  embed: EmbedFn;
  reranker: Pick<RerankGateway, 'rerank'>;
}

async function qualityOfSet(
  dir: string,
  set: EvalSet,
  options: QualityOptions,
): Promise<{ report: QualitySetReport; hybridName: string; baselineName: string }> {
  const baselineRanker = bm25Ranker();
  const baseline = runSet(baselineRanker, set);
  const { hybrid: hybridRanker } = await hybridRankers(set, options.embed, options.reranker);
  const hybrid = runSet(hybridRanker, set);
  const cases = loadAnswers(dir);
  const answers = cases === null ? null : await runAnswerEval(cases, set);
  const hybridByQuery = new Map(hybrid.perQuery.map((q) => [q.id, q.ndcg10]));
  return {
    baselineName: baselineRanker.name,
    hybridName: hybridRanker.name,
    report: {
      metrics: {
        recall50: baseline.recall50,
        ndcg10: baseline.ndcg10,
        ndcg10Hybrid: hybrid.ndcg10,
        citationAccuracy: answers?.citationAccuracy ?? null,
        quoteVerificationRate: answers?.quoteVerificationRate ?? null,
        pinpointAccuracy: answers?.pinpointAccuracy ?? null,
        falseVerified: answers?.falseVerified ?? null,
      },
      answers,
      perQuery: baseline.perQuery.map((q) => ({
        id: q.id,
        ndcg10: q.ndcg10,
        ndcg10Hybrid: hybridByQuery.get(q.id) ?? 0,
        recall50: q.recall50,
      })),
    },
  };
}

export async function buildQualityReport(options: QualityOptions): Promise<QualityReport> {
  const synthetic = await qualityOfSet(
    options.syntheticDir,
    loadPinnedSet(options.syntheticDir),
    options,
  );
  const dir = options.privateDir;
  const hasPrivate = dir !== undefined && dir !== '' && existsSync(dir);
  const privateSet = hasPrivate ? await qualityOfSet(dir, loadEvalSet(dir), options) : null;
  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    rankers: { baseline: synthetic.baselineName, hybrid: synthetic.hybridName },
    synthetic: synthetic.report,
    private: privateSet?.report ?? null,
  };
}

export interface MetricComparison {
  metric: QualityMetric;
  baseline: number;
  /** Null when the set produced no value (no answers.json): counted as a regression. */
  current: number | null;
  /** current - baseline. */
  delta: number | null;
  tolerance: number;
  regressed: boolean;
}

/** One comparison per gated metric, in QUALITY_METRICS order. */
export function compareQuality(
  current: QualityMetrics,
  baseline: QualityBaseline,
  thresholds: QualityThresholds,
): MetricComparison[] {
  return QUALITY_METRICS.map((metric) => {
    const { tolerance, direction } = thresholds[metric];
    const now = current[metric];
    const delta = now === null ? null : now - baseline[metric];
    const worse = delta === null ? Infinity : direction === 'higher-is-better' ? -delta : delta;
    return {
      metric,
      baseline: baseline[metric],
      current: now,
      delta,
      tolerance,
      regressed: worse > tolerance + 1e-9,
    };
  });
}

/**
 * The failure messages of the gate, each naming its metric; empty when the run passes. Only the
 * synthetic set is gated. A false-verified claim fails regardless of any tolerance (D-004).
 */
export function gateQuality(
  report: QualityReport,
  baseline: QualityBaseline,
  thresholds: QualityThresholds,
): string[] {
  const failures = compareQuality(report.synthetic.metrics, baseline, thresholds)
    .filter((c) => c.regressed && c.metric !== 'falseVerified')
    .map(
      (c) =>
        `${c.metric} regressed: baseline ${String(c.baseline)}, now ${String(c.current)} ` +
        `(tolerance ${String(c.tolerance)})`,
    );
  const falseVerified = report.synthetic.metrics.falseVerified;
  if (falseVerified === null || falseVerified > 0) {
    failures.push(
      `falseVerified is ${String(falseVerified)}: a claim that fails verification was shown as verified (D-004)`,
    );
  }
  return failures;
}

/** `--update-baseline`: rewrites baseline.json (every gated metric) and manifest.json together. */
export function updateBaseline(dir: string, report: QualityReport): QualityBaseline {
  const m = report.synthetic.metrics;
  const value = (v: number | null, metric: string): number => {
    if (v === null) throw new Error(`update-baseline: the synthetic set has no ${metric}`);
    return v;
  };
  const baseline: QualityBaseline = {
    recall50: m.recall50,
    ndcg10: m.ndcg10,
    ndcg10Hybrid: m.ndcg10Hybrid,
    citationAccuracy: value(m.citationAccuracy, 'citationAccuracy'),
    quoteVerificationRate: value(m.quoteVerificationRate, 'quoteVerificationRate'),
    pinpointAccuracy: value(m.pinpointAccuracy, 'pinpointAccuracy'),
    falseVerified: value(m.falseVerified, 'falseVerified'),
  };
  writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(buildManifest(dir), null, 2)}\n`);
  writeFileSync(path.join(dir, 'baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
}
