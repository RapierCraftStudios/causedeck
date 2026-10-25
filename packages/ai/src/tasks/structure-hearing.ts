import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence, language } from './shared.ts';

const input = z.object({
  transcript: z.string().min(1),
  /** The hearing date (`YYYY-MM-DD`) relative phrases are read against. */
  hearingDate: z.string().optional(),
  languageHints: z.array(language).max(9).optional(),
});

/** A character range of the transcript the model quoted from, never the text itself. */
const span = z.object({ start: z.number().int().min(0), end: z.number().int().min(0) });

const output = z.object({
  matterRef: z.object({ text: z.string(), span }).nullable().optional(),
  outcome: z.object({ text: z.string(), span }).nullable(),
  adjournmentReason: z.object({ text: z.string(), span }).nullable().optional(),
  nextDate: z.object({ date: z.string().nullable(), phrase: z.string(), span }).nullable(),
  stageAfter: z.object({ text: z.string(), span }).nullable().optional(),
  directions: z.array(
    z.object({ text: z.string(), dueExpression: z.string().nullable().optional(), span }),
  ),
  tasks: z.array(z.object({ title: z.string(), span })),
  confidence,
});

export const structureHearing: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'structure_hearing',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 1024,
  promptId: 'structure_hearing.v2',
  defaultLevel: 2,
};
