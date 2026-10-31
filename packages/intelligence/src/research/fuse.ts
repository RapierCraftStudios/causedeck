// Fusion, reranking and grouping (#896, ADR 0051 §Query pipeline steps 3 to 5). Reciprocal rank fusion
// (k = 60) merges the two arms, with small boosts for the court's level and the log of the judgment's
// cited-by count (a factual authority signal from the citation graph, not an editorial one). The top
// 100 go through the rerank port; the final order is the reranker's, with the fused score breaking
// ties. A reranker that fails leaves the fused order. Results are grouped by judgment: each keeps its
// best three segments and the top 20 judgments are returned. Pure functions apart from the rerank call.
import type { RerankGateway } from '@causedeck/ai';

import type { FusedCandidate, RankedCandidates, SearchHit, SegmentCandidate } from './types.ts';

export const RRF_K = 60;
/** Candidates sent to the reranker. */
export const RERANK_TOP = 100;
export const SEGMENTS_PER_JUDGMENT = 3;
export const RESULT_JUDGMENTS = 20;
/** Characters of a segment sent to the reranker and returned in a hit. */
export const SEGMENT_CHARS = 1500;

/** Added to a fused score: of the order of one rank position at the top of a list (1/60 is 0.0167). */
export const COURT_LEVEL_BOOST: Readonly<Record<string, number>> = {
  supreme_court: 0.0015,
  high_court: 0.0007,
};
export const CITED_BY_WEIGHT = 0.0005;

export function candidateBoost(
  candidate: Pick<SegmentCandidate, 'courtLevel' | 'citedByCount'>,
): number {
  return (
    (COURT_LEVEL_BOOST[candidate.courtLevel] ?? 0) +
    CITED_BY_WEIGHT * Math.log(1 + Math.max(0, candidate.citedByCount))
  );
}

/** Reciprocal rank fusion of ranked lists of segments, best first; ties break on segment id. */
export function fuseArms(arms: readonly RankedCandidates[]): FusedCandidate[] {
  const merged = new Map<string, FusedCandidate>();
  for (const arm of arms) {
    arm.forEach((candidate, index) => {
      const gain = 1 / (RRF_K + index + 1);
      const seen = merged.get(candidate.segmentId);
      if (seen === undefined) {
        merged.set(candidate.segmentId, { ...candidate, fusedScore: gain, rerankScore: null });
      } else {
        seen.fusedScore += gain;
      }
    });
  }
  const fused = [...merged.values()];
  for (const c of fused) c.fusedScore += candidateBoost(c);
  return fused.sort(
    (a, b) => b.fusedScore - a.fusedScore || a.segmentId.localeCompare(b.segmentId),
  );
}

export interface RerankOutcome {
  candidates: FusedCandidate[];
  /** False when the reranker was not used (it failed, or there was nothing to rerank). */
  reranked: boolean;
  costPaise: number;
}

/** Reranks the top `RERANK_TOP` of `fused` against `query`; the rest follow in fused order. */
export async function rerankCandidates(
  query: string,
  fused: readonly FusedCandidate[],
  gateway: Pick<RerankGateway, 'rerank'>,
): Promise<RerankOutcome> {
  const top = fused.slice(0, RERANK_TOP);
  if (top.length === 0) return { candidates: [], reranked: false, costPaise: 0 };
  try {
    const result = await gateway.rerank(
      query,
      top.map((c) => c.text.slice(0, SEGMENT_CHARS)),
    );
    const scored = top.map((c, i): FusedCandidate => ({
      ...c,
      rerankScore: result.scores[i] ?? 0,
    }));
    scored.sort(
      (a, b) =>
        (b.rerankScore ?? 0) - (a.rerankScore ?? 0) ||
        b.fusedScore - a.fusedScore ||
        a.segmentId.localeCompare(b.segmentId),
    );
    return {
      candidates: [...scored, ...fused.slice(RERANK_TOP)],
      reranked: true,
      costPaise: result.costPaise,
    };
  } catch {
    return { candidates: [...fused], reranked: false, costPaise: 0 };
  }
}

/** Groups ordered candidates by judgment: best three segments each, the top 20 judgments in order of their best. */
export function groupByJudgment(
  ordered: readonly FusedCandidate[],
  limit: number = RESULT_JUDGMENTS,
): SearchHit[] {
  const hits = new Map<string, SearchHit>();
  for (const c of ordered) {
    const score = c.rerankScore ?? c.fusedScore;
    let hit = hits.get(c.judgmentId);
    if (hit === undefined) {
      if (hits.size >= limit) continue;
      hit = {
        judgmentId: c.judgmentId,
        court: c.court,
        courtLevel: c.courtLevel,
        judgmentDate: c.judgmentDate,
        neutralCitation: c.neutralCitation,
        title: c.title,
        titleMasked: c.titleMasked,
        outcome: c.outcome,
        citedByCount: c.citedByCount,
        sourceUrl: c.sourceUrl,
        score,
        segments: [],
      };
      hits.set(c.judgmentId, hit);
    }
    if (hit.segments.length < SEGMENTS_PER_JUDGMENT) {
      hit.segments.push({
        segmentId: c.segmentId,
        role: c.role,
        pageFrom: c.pageFrom,
        pageTo: c.pageTo,
        text: c.text.slice(0, SEGMENT_CHARS),
        score,
      });
    }
  }
  return [...hits.values()];
}
