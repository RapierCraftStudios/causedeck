// The optional answer (#896, ADR 0051 §Query pipeline step 6). The model gets the question and the
// segment ids and anonymised text of the hits, nothing else, and returns claims that each point at one
// segment with a verbatim quote. Every claim is verified here: the segment must be one the model was
// given and the quote must appear in its text (the #891 faithfulness check). A claim that fails stays in
// the answer marked unsupported and is never shown as verified. No hits, or a model that finds nothing
// to claim, is the valid answer "no matching authority found"; a failing model call is an error the
// caller reports, never an invented answer.
import type { AiGateway, RunContext } from '@causedeck/ai';
import { z } from 'zod';

import { checkAnswer } from './eval/faithfulness.ts';
import type { EvalCorpus } from './eval/types.ts';
import type { SearchHit } from './types.ts';

/** Segments shown to the model. */
export const ANSWER_SEGMENTS = 12;

export interface AnswerInput {
  query: string;
  segments: { id: string; text: string }[];
}

/** Asks the model; returns whatever it replied (validated by `answerQuery`). */
export type AnswerResolver = (input: AnswerInput) => Promise<unknown>;

export function createGatewayAnswerResolver(options: {
  gateway: AiGateway;
  scope: Pick<RunContext, 'workspaceId'>;
}): AnswerResolver {
  return async (input) => {
    const result = await options.gateway.run('answer_research_query', input, {
      ...options.scope,
      purpose: 'research.answer',
    });
    return result.output;
  };
}

const replySchema = z.object({
  claims: z.array(z.object({ statement: z.string(), segmentId: z.string(), quote: z.string() })),
});

export interface AnswerClaim {
  statement: string;
  segmentId: string;
  /** The judgment the segment belongs to; null when the model named a segment it was not given. */
  judgmentId: string | null;
  quote: string;
  /** True only when the segment was given to the model and the quote is found in its text. */
  verified: boolean;
}

export interface ResearchAnswer {
  claims: AnswerClaim[];
  /** No hits, or nothing to claim: "no matching authority found". */
  noAuthority: boolean;
}

export async function answerQuery(
  query: string,
  hits: readonly SearchHit[],
  resolve: AnswerResolver,
): Promise<ResearchAnswer> {
  const segments = hits
    .flatMap((h) => h.segments.map((s) => ({ judgmentId: h.judgmentId, ...s })))
    .slice(0, ANSWER_SEGMENTS);
  if (segments.length === 0) return { claims: [], noAuthority: true };

  const reply = replySchema.safeParse(
    await resolve({ query, segments: segments.map((s) => ({ id: s.segmentId, text: s.text })) }),
  );
  if (!reply.success) throw new Error('research answer: the model reply did not match its schema');

  // The faithfulness check works on a corpus of judgments with segments; the shown segments are one.
  const byJudgment = new Map<string, EvalCorpus['judgments'][number]>();
  for (const s of segments) {
    const entry = byJudgment.get(s.judgmentId) ?? {
      id: s.judgmentId,
      title: s.judgmentId,
      court: 'x',
      segments: [],
    };
    entry.segments.push({ id: s.segmentId, page: s.pageFrom, text: s.text });
    byJudgment.set(s.judgmentId, entry);
  }
  const corpus: EvalCorpus = { judgments: [...byJudgment.values()] };
  const owner = new Map(segments.map((s) => [s.segmentId, s.judgmentId]));

  const claims = reply.data.claims.map((c): AnswerClaim => {
    const judgmentId = owner.get(c.segmentId) ?? null;
    const check = checkAnswer(
      { quotes: [{ judgmentId: judgmentId ?? '', segmentId: c.segmentId, text: c.quote }] },
      corpus,
    );
    return {
      statement: c.statement,
      segmentId: c.segmentId,
      judgmentId,
      quote: c.quote,
      verified: judgmentId !== null && check.quotesMatching === 1 && check.citationsExisting === 1,
    };
  });
  return { claims, noAuthority: claims.length === 0 };
}
