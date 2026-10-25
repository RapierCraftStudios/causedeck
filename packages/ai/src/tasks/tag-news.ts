import { z } from 'zod';

import type { TaskDef } from '../types.ts';

// The closed tag lists of the news digest (#481). Mirrors `NEWS_PRACTICE_AREAS` and `NEWS_FORUMS`
// in `@causedeck/db` (ai does not import db; a core test keeps the two lists equal).
export const NEWS_TAG_PRACTICE_AREAS = [
  'civil',
  'criminal',
  'constitutional',
  'corporate',
  'tax',
  'ibc',
  'arbitration',
  'family',
  'labour',
  'property',
  'ip',
  'consumer',
  'environment',
  'banking',
  'service',
] as const;

export const NEWS_TAG_FORUMS = [
  'supreme_court',
  'high_court',
  'district_court',
  'nclt',
  'nclat',
  'itat',
  'drt',
  'consumer_forum',
  'tribunal',
  'regulator',
] as const;

// Headline and the feed's own excerpt only: never article text.
const input = z.object({ title: z.string().min(1), excerpt: z.string().optional() });
// Enum arrays only: the model cannot return free text.
const output = z.object({
  practiceAreas: z.array(z.enum(NEWS_TAG_PRACTICE_AREAS)).max(5),
  forums: z.array(z.enum(NEWS_TAG_FORUMS)).max(5),
});

export const tagNews: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'tag_news',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 128,
  promptId: 'tag_news.v1',
  defaultLevel: 1,
};
