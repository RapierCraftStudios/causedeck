import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence } from './shared.ts';

const input = z.object({ text: z.string().min(1), forumId: z.string().optional() });
const output = z.object({
  rows: z.array(
    z.object({ caseNumber: z.string(), serial: z.string().nullable(), text: z.string() }),
  ),
  confidence,
});

export const parseListA0: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'parse_list_a0',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 2048,
  promptId: 'parse_list_a0.v1',
  defaultLevel: 2,
};
