import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence } from './shared.ts';

// Subject areas of a public judgment (#894). The vocabulary lives in `@causedeck/intelligence`
// (this package does not depend on it): the caller sends the allowed areas and validates the reply
// against them again, so an area outside the list is dropped there, never trusted from here.
const input = z.object({
  text: z.string().min(1),
  areas: z.array(z.string().min(1)).min(1).max(100),
});
const output = z.object({
  tags: z.array(z.object({ area: z.string(), confidence })).max(20),
});

export const tagJudgmentSubject: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'tag_judgment_subject',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 512,
  promptId: 'tag_judgment_subject.v1',
  defaultLevel: 2,
};
