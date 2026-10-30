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
