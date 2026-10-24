import { z } from 'zod';

import type { TaskDef } from '../types.ts';

const input = z.object({
  text: z.string().min(1),
  maxSentences: z.number().int().min(1).optional(),
});
const output = z.object({ summary: z.string() });

export const summarise: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'summarise',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 512,
  promptId: 'summarise.v1',
  defaultLevel: 1,
};
