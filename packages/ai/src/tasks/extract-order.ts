// `extract_order` (#46): the model's half of anchored order extraction. It returns what it read
// with the verbatim quote and page of each field, never offsets; the code in
// `@causedeck/intelligence` verifies every quote and every date literal against the page text, so
// the model never decides what survives. Dates it returns that the text does not contain are
// rejected there. The deterministic pre-parse candidates arrive as `hints`.
import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence, isoDate } from './shared.ts';

export const DIRECTION_KINDS = [
  'compliance',
  'filing',
  'appearance',
  'production',
  'payment',
  'listing',
  'other',
] as const;

const input = z.object({
  /** Page texts joined under `[[PAGE n]]` markers. */
  text: z.string().min(1),
  pageCount: z.number().int().min(1).optional(),
  /** Our extraction rules and synthetic few-shot examples (never document text). */
  guidance: z.string().optional(),
  hints: z
    .object({
      orderDate: isoDate.nullable(),
      nextDates: z.array(z.object({ date: isoDate, phrase: z.string(), page: z.number().int() })),
      caseNumbers: z.array(z.string()),
    })
    .optional(),
});

const quoted = z.object({ page: z.number().int().min(1), quote: z.string().min(1).max(2000) });

const output = z.object({
  bench: z.array(quoted.extend({ name: z.string().min(1) })),
  orderDate: quoted.extend({ date: isoDate }).nullable(),
  caseNumbers: z.array(quoted.extend({ value: z.string().min(1) })),
  neutralCitation: quoted.extend({ value: z.string().min(1) }).nullable(),
  orderType: z.enum(['interim', 'final', 'procedural']),
  directions: z.array(
    quoted.extend({
      text: z.string().min(1),
      kind: z.enum(DIRECTION_KINDS),
      dueExpression: z.string().nullable(),
      dueDate: isoDate.nullable(),
    }),
  ),
  nextDate: quoted.extend({ date: isoDate.nullable(), phrase: z.string().min(1) }).nullable(),
  stageCues: z.array(quoted.extend({ stage: z.string().min(1) })),
  confidence,
});

export type ExtractOrderInput = z.infer<typeof input>;
export type ExtractOrderOutput = z.infer<typeof output>;

export const extractOrder: TaskDef<ExtractOrderInput, ExtractOrderOutput> = {
  id: 'extract_order',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 4096,
  promptId: 'extract_order.v2',
  defaultLevel: 2,
};
