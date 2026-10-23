import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence } from './shared.ts';

/** Mirrors `NOTICE_KINDS` in `@causedeck/db` (this package does not depend on it); a test pins them. */
export const NOTICE_TAG_KINDS = [
  'circular',
  'practice_direction',
  'roster',
  'holiday',
  'registry',
  'bar_council',
  'gazette',
  'other',
] as const;

const input = z.object({
  title: z.string().min(1),
  text: z.string().optional(),
  sourceId: z.string().min(1),
});
const output = z.object({
  kind: z.enum(NOTICE_TAG_KINDS),
  forumCodes: z.array(z.string()),
  confidence,
});

export const tagNotice: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'tag_notice',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 256,
  promptId: 'tag_notice.v1',
  defaultLevel: 2,
};
