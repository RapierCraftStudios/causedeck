// The validated extraction (#46): what survives `validate.ts`. Every field that is not derived
// carries an anchor `{ documentId, page, quote, charStart, charEnd }` that `verifyAnchor` accepted;
// a field without one is removed and recorded in `rejected[]`. Derived dates (relative phrases the
// code resolved) carry the anchor of their phrase and a `derivation`.
import { ORDER_TYPES } from '@causedeck/validators/matter-graph';
import { z } from 'zod';

/** Kept equal to the `extract_order` task's kinds (`@causedeck/ai`); the model picks one. */
export const DIRECTION_KINDS = [
  'compliance',
  'filing',
  'appearance',
  'production',
  'payment',
  'listing',
  'other',
] as const;
export type DirectionKind = (typeof DIRECTION_KINDS)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ExtractionAnchorSchema = z.strictObject({
  documentId: z.uuid(),
  page: z.number().int().positive(),
  quote: z.string().min(1).max(2000),
  charStart: z.number().int().min(0),
  charEnd: z.number().int().min(0),
});
export type ExtractionAnchor = z.infer<typeof ExtractionAnchorSchema>;

export const DerivationSchema = z.strictObject({
  basis: z.literal('orderDate'),
  n: z.number().int().positive(),
  unit: z.enum(['day', 'week', 'month']),
  rule: z.string(),
});

const anchored = { anchor: ExtractionAnchorSchema };

export const NextDateSchema = z.strictObject({
  date: day,
  phrase: z.string().min(1),
  derived: z.boolean().optional(),
  derivation: DerivationSchema.optional(),
  /** Where the candidate came from: the regex pre-parse or the model. */
  source: z.enum(['preparse', 'model']).optional(),
  ...anchored,
});
export type NextDate = z.infer<typeof NextDateSchema>;

export const DirectionSchema = z.strictObject({
  text: z.string().min(1),
  kind: z.enum(DIRECTION_KINDS),
  dueExpression: z.string().optional(),
  dueDate: day.optional(),
  derived: z.boolean().optional(),
  derivation: DerivationSchema.optional(),
  ...anchored,
});
export type Direction = z.infer<typeof DirectionSchema>;

export const REJECTION_REASONS = [
  'no_anchor',
  'date_not_in_source',
  'decoy_date',
  'conflict',
  'unresolvable_relative',
  'injection_demoted',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const RejectedSchema = z.strictObject({
  field: z.string(),
  reason: z.enum(REJECTION_REASONS),
  /** What the model or pre-parse offered (never trusted; for the inbox card). */
  value: z.string().max(2000).optional(),
  page: z.number().int().positive().optional(),
});
export type Rejected = z.infer<typeof RejectedSchema>;

export const NEEDS_YOU_REASONS = [
  'extraction_unanchored',
  'extraction_ambiguous',
  'extraction_suspicious',
  'extraction_low_confidence',
] as const;
export type ExtractionNeedsYouReason = (typeof NEEDS_YOU_REASONS)[number];

export const OrderExtractionSchema = z.strictObject({
  documentId: z.uuid(),
  pipelineVersion: z.string().min(1),
  bench: z.array(z.strictObject({ name: z.string().min(1), ...anchored })),
  orderDate: z.strictObject({ date: day, ...anchored }).optional(),
  caseNumbers: z.array(z.strictObject({ value: z.string().min(1), ...anchored })),
  neutralCitation: z.strictObject({ value: z.string().min(1), ...anchored }).optional(),
  orderType: z.enum(ORDER_TYPES),
  directions: z.array(DirectionSchema),
  nextDate: NextDateSchema.optional(),
  /** Every candidate next date when there is more than one, or the sources disagree. */
  candidates: z.array(NextDateSchema),
  stageCues: z.array(z.strictObject({ stage: z.string().min(1), ...anchored })),
  /** Several or conflicting next dates: the extraction does not choose. */
  ambiguous: z.boolean(),
  /** The order held instruction-like text: its dates are demoted. */
  suspicious: z.boolean(),
  /** Only the regex pre-parse ran (an `ai_blocked` capture or a sensitive matter). */
  deterministicOnly: z.boolean(),
  confidence: z.number().min(0).max(1),
  rejected: z.array(RejectedSchema),
  needsYou: z.array(z.enum(NEEDS_YOU_REASONS)),
});
export type OrderExtraction = z.infer<typeof OrderExtractionSchema>;
