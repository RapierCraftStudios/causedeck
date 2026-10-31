// Shared shapes of the fact-pattern search (#896, ADR 0051 §Query pipeline).
import type { OutcomeValue, SegmentRole, StatuteSection, SubjectArea } from '../corpus/index.ts';

export type CourtLevel = 'supreme_court' | 'high_court' | 'other';

/** The structured form of a query: filters (chips) plus the text each arm searches with. */
export interface ResearchPlan {
  /** The advocate's own words. */
  query: string;
  /** What the vector arm embeds (the advocate's words when the planner added nothing). */
  factDescription: string;
  /** Terms for the lexical arm. */
  keywords: string[];
  subjectAreas: SubjectArea[];
  /** Statutes as entered; retrieval expands each through the IPC/BNS, CrPC/BNSS, IEA/BSA map. */
  statutes: StatuteSection[];
  /** Court codes as printed in a neutral citation (`MHC`, `KHC`, `INSC`). */
  courts: string[];
  courtLevel: CourtLevel | null;
  dateFrom: string | null;
  dateTo: string | null;
  outcome: Exclude<OutcomeValue, 'unknown'> | null;
  /** Picks which code of a statute pair governs; shown on the statute chips. */
  offenceDate: string | null;
  /** Who produced it: the gateway planner merged over the rules, or the rules alone. */
  planner: 'gateway' | 'heuristic';
}

/** A passage of a redacted judgment with the judgment facts the fusion and the result view need. */
export interface SegmentCandidate {
  segmentId: string;
  judgmentId: string;
  judgmentYear: number;
  ordinal: number;
  role: SegmentRole;
  pageFrom: number;
  pageTo: number;
  /** `judgment_segment.text`: the redacted text, never `judgment.page_text` (D-053). */
  text: string;
  court: string;
  courtLevel: string;
  /** `judgment.case_title`: already the masked form when `titleMasked`. */
  title: string | null;
  titleMasked: boolean;
  neutralCitation: string | null;
  judgmentDate: string | null;
  outcome: OutcomeValue;
  citedByCount: number;
  sourceUrl: string | null;
}

/** Candidates of one arm, best first. */
export type RankedCandidates = SegmentCandidate[];

/** The two retrieval arms. The SQL one is `drizzleRetriever`; tests and the eval harness use in-memory ones. */
export interface SegmentRetriever {
  lexical(plan: ResearchPlan, limit: number): Promise<RankedCandidates>;
  vector(
    embedding: readonly number[],
    plan: ResearchPlan,
    limit: number,
  ): Promise<RankedCandidates>;
}

export interface FusedCandidate extends SegmentCandidate {
  /** Reciprocal rank fusion score with the court-level and cited-by boosts. */
  fusedScore: number;
  /** The reranker's score; null before reranking or when the reranker failed. */
  rerankScore: number | null;
}

export interface SearchSegment {
  segmentId: string;
  role: SegmentRole;
  pageFrom: number;
  pageTo: number;
  text: string;
  score: number;
}

export interface SearchHit {
  judgmentId: string;
  court: string;
  courtLevel: string;
  judgmentDate: string | null;
  neutralCitation: string | null;
  title: string | null;
  titleMasked: boolean;
  outcome: OutcomeValue;
  citedByCount: number;
  sourceUrl: string | null;
  score: number;
  /** The best segments of this judgment (at most three), best first. */
  segments: SearchSegment[];
}
