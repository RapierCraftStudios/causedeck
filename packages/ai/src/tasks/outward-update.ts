import { z } from 'zod';

import type { TaskDef } from '../types.ts';

/** One fact line already composed from the matter graph; the model may only reword around it. */
const fact = z.object({
  kind: z.enum(['next_date', 'outcome', 'obligation']),
  text: z.string().min(1),
  confirmed: z.boolean(),
});

const input = z.object({
  audience: z.enum(['client', 'senior_counsel', 'briefing_counsel']),
  language: z.enum(['en', 'ta', 'kn']),
  tone: z.enum(['formal', 'brief', 'warm']),
  facts: z.array(fact).min(1),
});

/** Narrative blocks around the fact lines; the facts themselves are inserted by the caller. */
const output = z.object({
  blocks: z
    .array(
      z.object({
        kind: z.enum(['opening', 'closing']),
        text: z.string().min(1),
      }),
    )
    .max(4),
});

export type OutwardUpdateInput = z.infer<typeof input>;
export type OutwardUpdateOutput = z.infer<typeof output>;

export const outwardUpdate: TaskDef<OutwardUpdateInput, OutwardUpdateOutput> = {
  id: 'outward_update',
  input,
  output,
  // Sarvam serves speech, OCR and translation only; Tamil and Kannada drafting runs on Bedrock.
  providers: ['bedrock'],
  maxOutputTokens: 800,
  promptId: 'outward_update.v1',
  defaultLevel: 1,
  tier: 'drafting',
};
