// `parse_list_a0` (#56): the model's half of the A0 generic list parse, for a forum with no
// dedicated adapter. It returns what it read with the page and the verbatim quote of each row; the
// code in `@causedeck/adapters` verifies every quote, that the case number sits inside it and that
// every date is written in it, so the model never decides what survives. The deterministic
// skeleton candidates arrive as `hints`. Dates are claims, never inferred.
import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence, isoDate } from './shared.ts';

/** A rectangle on a page, in PDF points (the model may echo one the layout gave it). */
export const a0Bbox = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
});

/** Where a claimed value was read: the page, the verbatim quote and a line reference or box. */
export const a0Anchor = {
  page: z.number().int().min(1),
  quote: z.string().min(1).max(2000),
  /** 1-based line of the page the quote starts on; the code recomputes it from the page text. */
  lineRef: z.number().int().min(1).nullable(),
  bbox: a0Bbox.optional(),
} as const;

const input = z.object({
  /** Page texts joined under `[[PAGE n]]` markers. */
  text: z.string().min(1),
  pageCount: z.number().int().min(1).optional(),
  forumId: z.string().optional(),
  /** The forum's language profile (`en`, `ta`, `kn`): Tamil and Kannada rows keep their script. */
  languages: z.array(z.string()).optional(),
  /** Our extraction rules (never document text). */
  guidance: z.string().optional(),
  /** The deterministic skeleton candidates, as hints. */
  hints: z
    .object({
      caseNumbers: z.array(z.string()),
      cnrs: z.array(z.string()),
      dates: z.array(z.object({ date: isoDate, page: z.number().int() })),
    })
    .optional(),
});

const output = z.object({
  listDate: z.object({ ...a0Anchor, date: isoDate }).nullable(),
  rows: z.array(
    z.object({
      ...a0Anchor,
      caseNumber: z.string().min(1),
      cnr: z.string().nullable(),
      serial: z.string().nullable(),
      parties: z.string().nullable(),
      stageText: z.string().nullable(),
      hall: z.string().nullable(),
      /** Absolute dates the row's quote is claimed to contain, as YYYY-MM-DD. */
      dates: z.array(isoDate),
    }),
  ),
  confidence,
});

export type ParseListA0Input = z.infer<typeof input>;
export type ParseListA0Output = z.infer<typeof output>;

export const parseListA0: TaskDef<ParseListA0Input, ParseListA0Output> = {
  id: 'parse_list_a0',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 4096,
  promptId: 'parse_list_a0.v2',
  defaultLevel: 2,
};
