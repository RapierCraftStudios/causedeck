// `parse_order_a0` (#56): the model's half of the A0 generic order parse. Every field carries its
// page and verbatim quote; `@causedeck/adapters` checks them with the rules of #46 (a quote must be
// on its page, an absolute date must be written in it, a relative date is computed by code from the
// anchored phrase and the order date). The model is never asked for, and never trusted with, a date
// the text does not contain.
import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { DIRECTION_KINDS } from './extract-order.ts';
import { a0Anchor } from './parse-list-a0.ts';
import { confidence, isoDate } from './shared.ts';

const input = z.object({
  /** Page texts joined under `[[PAGE n]]` markers. */
  text: z.string().min(1),
  pageCount: z.number().int().min(1).optional(),
  forumId: z.string().optional(),
  languages: z.array(z.string()).optional(),
  guidance: z.string().optional(),
  hints: z
    .object({
      orderDate: isoDate.nullable(),
      nextDates: z.array(z.object({ date: isoDate, phrase: z.string(), page: z.number().int() })),
      caseNumbers: z.array(z.string()),
      cnrs: z.array(z.string()),
    })
    .optional(),
});

const anchor = z.object(a0Anchor);

const output = z.object({
  caseNumbers: z.array(anchor.extend({ value: z.string().min(1) })),
  cnrs: z.array(anchor.extend({ value: z.string().min(1) })),
  parties: z.array(anchor.extend({ name: z.string().min(1) })),
  orderDate: anchor.extend({ date: isoDate }).nullable(),
  orderType: z.enum(['interim', 'final', 'procedural']),
  directions: z.array(
    anchor.extend({
      text: z.string().min(1),
      kind: z.enum(DIRECTION_KINDS),
      dueExpression: z.string().nullable(),
      dueDate: isoDate.nullable(),
    }),
  ),
  nextDate: anchor.extend({ date: isoDate.nullable(), phrase: z.string().min(1) }).nullable(),
  confidence,
});

export type ParseOrderA0Input = z.infer<typeof input>;
export type ParseOrderA0Output = z.infer<typeof output>;

export const parseOrderA0: TaskDef<ParseOrderA0Input, ParseOrderA0Output> = {
  id: 'parse_order_a0',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 4096,
  promptId: 'parse_order_a0.v1',
  defaultLevel: 2,
};
