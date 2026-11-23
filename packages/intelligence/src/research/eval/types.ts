// The retrieval evaluation set (ADR 0051 §Evaluation, #891): a corpus of judgments split into
// page-anchored segments, and queries with graded relevant judgments (0 = not relevant .. 3 = ideal).
import { z } from 'zod';

export const segmentSchema = z.object({
  id: z.string().min(1),
  page: z.number().int().positive(),
  text: z.string().min(1),
});

export const corpusSchema = z.object({
  judgments: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        court: z.string().min(1),
        segments: z.array(segmentSchema).min(1),
      }),
    )
    .min(1),
});

export const queriesSchema = z.object({
  queries: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        facets: z.record(z.string(), z.string()).optional(),
        /** Judgment id to grade 0-3. Judgments not listed are grade 0. */
        judgments: z.record(z.string(), z.number().int().min(0).max(3)),
      }),
    )
    .min(1),
});

export type Segment = z.infer<typeof segmentSchema>;
export type EvalCorpus = z.infer<typeof corpusSchema>;
export type EvalQuery = z.infer<typeof queriesSchema>['queries'][number];

/** A quote a generated answer attributes to one segment of one judgment. */
export interface AnswerQuote {
  judgmentId: string;
  segmentId: string;
  text: string;
}

export interface Answer {
  quotes: AnswerQuote[];
}

/** The system under test. The real hybrid retriever plugs in here; `answer` is optional. */
export interface Ranker {
  name: string;
  /** Judgment ids, best first. */
  rank(query: EvalQuery, corpus: EvalCorpus): string[];
  answer?(query: EvalQuery, corpus: EvalCorpus, ranked: string[]): Answer;
}

export interface QueryResult {
  id: string;
  ndcg10: number;
  recall50: number;
}

export interface SetMetrics {
  queries: number;
  ndcg10: number;
  recall50: number;
  /** Fraction of quotes found verbatim in the cited segment; null when no answers were produced. */
  quoteFaithfulness: number | null;
  /** Fraction of cited judgment and segment ids that exist; null when no answers were produced. */
  citationFaithfulness: number | null;
  perQuery: QueryResult[];
}

/** The answer metrics of one set (#1119); see docs/engineering/copilot-quality.md. */
export interface AnswerMismatch {
  caseId: string;
  claimIndex: number;
  expected: string;
  actual: string;
}

export interface AnswerMetrics {
  cases: number;
  claims: number;
  /** Verified claims whose cited id exists and belongs to the reported judgment or document. */
  citationAccuracy: number;
  /** Claims expected to verify that did verify. */
  quoteVerificationRate: number;
  /** Verified claims with an expected pinpoint whose computed pinpoint equals it. */
  pinpointAccuracy: number;
  /** Claims expected unsupported that came back verified. Must be 0 (D-004). */
  falseVerified: number;
  mismatches: AnswerMismatch[];
}

export const QUALITY_METRICS = [
  'recall50',
  'ndcg10',
  'ndcg10Hybrid',
  'citationAccuracy',
  'quoteVerificationRate',
  'pinpointAccuracy',
  'falseVerified',
] as const;

export type QualityMetric = (typeof QUALITY_METRICS)[number];

/** The gated numbers of one set; the answer metrics are null when the set has no answers.json. */
export type QualityMetrics = Record<
  'recall50' | 'ndcg10' | 'ndcg10Hybrid',
  number
> &
  Record<'citationAccuracy' | 'quoteVerificationRate' | 'pinpointAccuracy' | 'falseVerified', number | null>;

export const baselineSchema = z.object({
  recall50: z.number(),
  ndcg10: z.number(),
  ndcg10Hybrid: z.number(),
  citationAccuracy: z.number(),
  quoteVerificationRate: z.number(),
  pinpointAccuracy: z.number(),
  falseVerified: z.number(),
});

export type QualityBaseline = z.infer<typeof baselineSchema>;

const tolerance = z.object({
  /** The largest allowed move in the bad direction. */
  tolerance: z.number().min(0),
  direction: z.enum(['higher-is-better', 'lower-is-better']),
});

export const thresholdsSchema = z.object({
  recall50: tolerance,
  ndcg10: tolerance,
  ndcg10Hybrid: tolerance,
  citationAccuracy: tolerance,
  quoteVerificationRate: tolerance,
  pinpointAccuracy: tolerance,
  falseVerified: tolerance,
});

export type QualityThresholds = z.infer<typeof thresholdsSchema>;
