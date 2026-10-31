import { z } from 'zod';

import type { TaskDef } from '../types.ts';

// The optional answer of a fact-pattern search (#896, ADR 0051 §Query pipeline step 6). The model gets
// the question and numbered passages of public, anonymised judgments (segment ids and redacted text
// only) and returns short claims, each pointing at one passage with a verbatim quote from it. The
// caller verifies every quote against the passage text and marks the claims that fail as unsupported;
// an empty list is a valid answer ("no matching authority found").
const input = z.object({
  query: z.string().min(1).max(4000),
  segments: z
    .array(z.object({ id: z.string().min(1).max(100), text: z.string().min(1).max(6000) }))
    .min(1)
    .max(30),
});

const output = z.object({
  claims: z
    .array(
      z.object({
        statement: z.string().min(1).max(600),
        segmentId: z.string().min(1).max(100),
        quote: z.string().min(1).max(600),
      }),
    )
    .max(10),
});

export const answerResearchQuery: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'answer_research_query',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 1200,
  promptId: 'answer_research_query.v1',
  defaultLevel: 1,
  tier: 'drafting',
};
