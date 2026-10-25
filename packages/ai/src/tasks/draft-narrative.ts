import { z } from 'zod';

import type { TaskDef } from '../types.ts';

const input = z.object({
  prompt: z.string().min(1),
  facts: z.record(z.string(), z.string()),
  maxChars: z.number().int().min(1),
  locale: z.enum(['en', 'kn', 'ta']).default('en'),
});
const output = z.object({ text: z.string() });

/** One narrative block of a draft; the model returns text only and never calls tools. */
export const draftNarrative: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'draft_narrative',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 2048,
  promptId: 'draft_narrative.v1',
  defaultLevel: 2,
  tier: 'drafting',
};
