// `HearingStructuredSchema` (#541): what structuring a hearing note must produce. Every field
// carries the span of the transcript it was read from (`[start, end)` character offsets); a field
// whose span is not inside the transcript is not accepted and lands in `rejected[]`.
import { z } from 'zod';

import type { Span } from './spoken-dates.ts';

export type { Span } from './spoken-dates.ts';

export const SpanSchema = z
  .strictObject({ start: z.int().min(0), end: z.int().min(1) })
  .refine((span) => span.end > span.start, 'a span ends after it starts');

const text = z.string().trim().min(1).max(2000);
const spanned = { text, span: SpanSchema };

export const HearingStructuredSchema = z.strictObject({
  /** How the matter was named aloud (a case number, a party name). */
  matterRef: z.strictObject(spanned).optional(),
  outcome: z.strictObject(spanned),
  adjournmentReason: z.strictObject(spanned).optional(),
  nextDate: z
    .strictObject({
      /** `YYYY-MM-DD`, always the parser's reading of `phrase`. */
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      phrase: text,
      span: SpanSchema,
    })
    .optional(),
  stageAfter: z.strictObject(spanned).optional(),
  directions: z
    .array(
      z.strictObject({
        text,
        dueExpression: text.optional(),
        /** The parser's reading of `dueExpression`; never supplied by the model. */
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        span: SpanSchema,
      }),
    )
    .max(50)
    .default([]),
  tasks: z
    .array(z.strictObject({ title: z.string().trim().min(1).max(500), span: SpanSchema }))
    .max(50)
    .default([]),
});
export type HearingStructured = z.output<typeof HearingStructuredSchema>;

/** What survives validation: the outcome itself may have been rejected. */
export const ValidatedHearingSchema = HearingStructuredSchema.partial({ outcome: true });
export type ValidatedHearing = z.output<typeof ValidatedHearingSchema>;

export const REJECT_REASONS = [
  'span_missing',
  'span_out_of_range',
  'phrase_mismatch',
  'date_untraceable',
  'date_mismatch',
  'not_after_hearing',
  'instruction_like',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export interface Rejected {
  /** Path of the field, e.g. `nextDate` or `directions[2]`. */
  field: string;
  reason: RejectReason;
  /** What the model said, kept so the person can read it. */
  value: unknown;
}

export interface FlaggedSpan {
  span: Span;
  reason: 'instruction_like';
}

export type NeedsYouReason = 'next_date_dropped' | 'outcome_dropped' | 'instruction_like_speech';

export interface StructuredResult {
  structured: ValidatedHearing;
  rejected: Rejected[];
  flagged: FlaggedSpan[];
  /** Why the capture goes to Needs you; null when it does not. */
  needsYou: { reasons: NeedsYouReason[] } | null;
  /** The model's own 0-1 confidence in the structuring. */
  confidence: number;
}

/** True when `span` is a non-empty range inside a transcript of `length` characters. */
export function spanInside(span: Span, length: number): boolean {
  return (
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end > span.start &&
    span.end <= length
  );
}

/** Whitespace-collapsed, case-folded text, for comparing a quoted phrase with the transcript. */
export const foldText = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();
