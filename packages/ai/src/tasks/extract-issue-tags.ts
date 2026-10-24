import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence } from './shared.ts';

const input = z.object({ text: z.string().min(1) });
const output = z.object({
  tags: z.array(
    z.object({
      statute: z.string().min(1),
      section: z.string().nullable(),
      issue: z.string().nullable(),
      confidence,
    }),
  ),
});

export const extractIssueTags: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'extract_issue_tags',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 1024,
  promptId: 'extract_issue_tags.v1',
  defaultLevel: 1,
};
