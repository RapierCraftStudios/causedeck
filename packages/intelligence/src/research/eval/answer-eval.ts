// The answer half of the copilot quality gate (#1119, ADR 0051 §Evaluation, D-004). Each case in
// `answers.json` scripts one model reply to a query of the set: good claims, altered quotes, foreign or
// unknown source ids, wrong model-claimed pinpoints and empty quotes, with the expected outcome of every
// claim. The real verifiers run on it, `answerQuery` (/research) and `answerMatterQuestion` (the
// copilot, #1115), with a resolver that returns the scripted reply, so no network, provider or database
// is involved. The pinpoint is never read from the reply: the verifier computes it from the stored text
// and the eval compares it with the expected one.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { answerQuery } from '../answer.ts';
import { answerMatterQuestion, pinpointOf, type CopilotSource } from '../answer-sources.ts';
import type { SearchHit } from '../types.ts';
import type { EvalSet } from './runner.ts';
import type { AnswerMetrics, AnswerMismatch, EvalCorpus, EvalQuery } from './types.ts';

const pinpointSchema = z.object({ page: z.number().int().nullable(), paragraph: z.number().int().nullable() });

const sourceSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  page: z.number().int().positive().nullable(),
  documentId: z.string().min(1).optional(),
  judgmentId: z.string().min(1).optional(),
});

const expectSchema = z.object({
  verified: z.boolean(),
  reason: z.enum(['unknown_source', 'quote_not_found']).optional(),
  pinpoint: pinpointSchema.optional(),
});

const caseSchema = z.object({
  id: z.string().min(1),
  queryId: z.string().min(1),
  task: z.enum(['answer_research_query', 'answer_matter_question']),
  /** Extra matter sources (`doc:`, `fact:`) shown next to the `seg:` sources of the query's judgments. */
  sources: z.array(sourceSchema).optional(),
  /** The scripted model reply, passed to the verifier unchanged (unknown fields included). */
  replies: z.object({ claims: z.array(z.record(z.string(), z.unknown())) }),
  /** One expectation per reply claim, in order. */
  expect: z.array(expectSchema),
});

export const answersSchema = z.object({ cases: z.array(caseSchema).min(1) });

export type AnswerCase = z.infer<typeof caseSchema>;
type Pinpoint = z.infer<typeof pinpointSchema>;

/** The cases of `dir/answers.json`; null when the set has none (the private set may omit it). */
export function loadAnswers(dir: string): AnswerCase[] | null {
  const file = path.join(dir, 'answers.json');
  if (!existsSync(file)) return null;
  const { cases } = answersSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  for (const c of cases) {
    if (c.expect.length !== c.replies.claims.length) {
      throw new Error(`answers.json case ${c.id}: ${String(c.replies.claims.length)} claims, ${String(c.expect.length)} expectations`);
    }
  }
  return cases;
}

/** The judgments the query grades relevant, best first: the hits the answer is given. */
function relevantJudgments(query: EvalQuery, corpus: EvalCorpus): EvalCorpus['judgments'] {
  return Object.entries(query.judgments)
    .filter(([, grade]) => grade >= 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .flatMap(([id]) => corpus.judgments.filter((j) => j.id === id));
}

function hitsOf(judgments: EvalCorpus['judgments']): SearchHit[] {
  return judgments.map((j, i) => ({
    judgmentId: j.id,
    court: j.court,
    courtLevel: 'high_court',
    judgmentDate: null,
    neutralCitation: null,
    title: j.title,
    titleMasked: false,
    outcome: 'unknown',
    citedByCount: 0,
    sourceUrl: null,
    score: 1 / (i + 1),
    segments: j.segments.map((s) => ({
      segmentId: s.id,
      role: 'reasoning',
      pageFrom: s.page,
      pageTo: s.page,
      text: s.text,
      score: 1,
    })),
  }));
}

/** The outcome of one claim, in a shape common to both verifiers. */
interface Outcome {
  verified: boolean;
  reason?: 'unknown_source' | 'quote_not_found';
  pinpoint: Pinpoint | null;
  /** True when the cited id exists in what the case knows and belongs where the claim says. */
  citationBelongs: boolean;
}

async function researchOutcomes(c: AnswerCase, query: EvalQuery, corpus: EvalCorpus): Promise<Outcome[]> {
  const segments = new Map(
    corpus.judgments.flatMap((j) => j.segments.map((s) => [s.id, { judgmentId: j.id, ...s }] as const)),
  );
  const answer = await answerQuery(query.text, hitsOf(relevantJudgments(query, corpus)), () =>
    Promise.resolve(c.replies),
  );
  return answer.claims.map((claim) => {
    const segment = segments.get(claim.segmentId);
    return {
      verified: claim.verified,
      pinpoint:
        segment === undefined
          ? null
          : pinpointOf({ id: `seg:${segment.id}`, text: segment.text, page: segment.page }, claim.quote),
      citationBelongs: segment !== undefined && segment.judgmentId === claim.judgmentId,
    };
  });
}

async function matterOutcomes(c: AnswerCase, query: EvalQuery, corpus: EvalCorpus): Promise<Outcome[]> {
  const sources: CopilotSource[] = [
    ...relevantJudgments(query, corpus).flatMap((j) =>
      j.segments.map((s) => ({ id: `seg:${s.id}`, text: s.text, page: s.page, judgmentId: j.id })),
    ),
    ...(c.sources ?? []).map((s) => ({ ...s })),
  ];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const answer = await answerMatterQuestion(query.text, sources, () => Promise.resolve(c.replies));
  // The verifier splits claims into verified and unsupported; put them back in reply order.
  const verified = [...answer.claims];
  const unsupported = [...answer.unsupported];
  return c.replies.claims.map((raw): Outcome => {
    const match = <T extends { sourceId: string; quote: string }>(list: T[]): T | undefined => {
      const i = list.findIndex((x) => x.sourceId === raw.sourceId && x.quote === raw.quote);
      return i < 0 ? undefined : list.splice(i, 1)[0];
    };
    const ok = match(verified);
    if (ok !== undefined) {
      const source = byId.get(ok.sourceId);
      return {
        verified: true,
        pinpoint: ok.pinpoint,
        citationBelongs:
          source !== undefined &&
          (source.documentId ?? null) === ok.documentId &&
          (source.judgmentId ?? null) === ok.judgmentId,
      };
    }
    const bad = match(unsupported);
    return { verified: false, reason: bad?.reason, pinpoint: null, citationBelongs: false };
  });
}

const ratio = (n: number, d: number): number => (d === 0 ? 1 : n / d);
const showPinpoint = (p: Pinpoint | null): string =>
  p === null ? 'none' : `page ${String(p.page)}, paragraph ${String(p.paragraph)}`;

/** Runs every case through its verifier and scores the outcomes against the expectations. */
export async function runAnswerEval(cases: readonly AnswerCase[], set: EvalSet): Promise<AnswerMetrics> {
  const queries = new Map(set.queries.map((q) => [q.id, q]));
  const t = { claims: 0, verified: 0, belonging: 0, expectedVerified: 0, verifiedAsExpected: 0, pinned: 0, pinnedRight: 0, falseVerified: 0 };
  const mismatches: AnswerMismatch[] = [];
  for (const c of cases) {
    const query = queries.get(c.queryId);
    if (query === undefined) throw new Error(`answers.json case ${c.id}: unknown query ${c.queryId}`);
    const outcomes =
      c.task === 'answer_research_query'
        ? await researchOutcomes(c, query, set.corpus)
        : await matterOutcomes(c, query, set.corpus);
    for (const [i, expected] of c.expect.entries()) {
      const actual = outcomes[i] ?? { verified: false, pinpoint: null, citationBelongs: false };
      const miss = (what: string, want: string, got: string): void => {
        mismatches.push({ caseId: c.id, claimIndex: i, expected: `${what} ${want}`, actual: `${what} ${got}` });
      };
      t.claims += 1;
      if (actual.verified) {
        t.verified += 1;
        if (actual.citationBelongs) t.belonging += 1;
        else miss('citation', 'belongs', 'does not belong');
      }
      if (expected.verified) {
        t.expectedVerified += 1;
        if (actual.verified) t.verifiedAsExpected += 1;
      } else if (actual.verified) {
        t.falseVerified += 1;
      }
      if (expected.verified !== actual.verified) {
        miss('verified', String(expected.verified), String(actual.verified));
      } else if (expected.reason !== undefined && expected.reason !== actual.reason) {
        miss('reason', expected.reason, actual.reason ?? 'none');
      }
      if (expected.pinpoint !== undefined && actual.verified) {
        t.pinned += 1;
        const right =
          actual.pinpoint !== null &&
          actual.pinpoint.page === expected.pinpoint.page &&
          actual.pinpoint.paragraph === expected.pinpoint.paragraph;
        if (right) t.pinnedRight += 1;
        else miss('pinpoint', showPinpoint(expected.pinpoint), showPinpoint(actual.pinpoint));
      }
    }
  }
  return {
    cases: cases.length,
    claims: t.claims,
    citationAccuracy: ratio(t.belonging, t.verified),
    quoteVerificationRate: ratio(t.verifiedAsExpected, t.expectedVerified),
    pinpointAccuracy: ratio(t.pinnedRight, t.pinned),
    falseVerified: t.falseVerified,
    mismatches,
  };
}
