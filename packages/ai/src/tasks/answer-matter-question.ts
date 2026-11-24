import { z } from 'zod';

import type { TaskDef } from '../types.ts';

// The grounded matter copilot (#1115, ADR 0051). The model gets the question and numbered sources of
// three kinds, told apart by the id prefix: `fact:` (a matter-graph fact), `doc:` (a page of a matter
// document) and `seg:` (a passage of an anonymised public judgment). It returns short claims, each
// pointing at one source id with a verbatim quote from it. No tools. The caller verifies every claim
// against the stored source text and computes the pinpoint itself (D-004); an empty list is a valid
// answer ("no authority found"). v2 (#1167) adds an optional written `answer`: plain-language prose
// citing the claims by 1-based position as `[n]` (or `[n, m]`) markers. The caller keeps only the
// markers of verified claims and renumbers them; a reply without `answer` (older fixtures and cached
// results) still parses and gets an answer composed from the verified claims.
const input = z.object({
  question: z.string().min(1).max(4000),
  sources: z
    .array(z.object({ id: z.string().min(1).max(120), text: z.string().min(1).max(6000) }))
    .min(1)
    .max(40),
});

const output = z.object({
  claims: z
    .array(
      z.object({
        statement: z.string().min(1).max(600),
        sourceId: z.string().min(1).max(120),
        quote: z.string().min(1).max(600),
      }),
    )
    .max(12),
  answer: z
    .string()
    .max(2000)
    .describe(
      'A short plain-language answer to the question that cites the claims by their 1-based position as [n] or [n, m] markers.',
    )
    .optional(),
});

export const answerMatterQuestion: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'answer_matter_question',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 1400,
  promptId: 'answer_matter_question.v2',
  defaultLevel: 1,
  tier: 'drafting',
};
