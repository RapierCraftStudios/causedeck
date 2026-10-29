// Limitation tracker data contract (#84, part 1 of 4): the zod shapes of a counsel-reviewed rule
// table and of one computation. Objects are strict, so an unknown key is an error. Rules come from
// counsel (#120); `reviewed` stays false until counsel signs a rule off, and only reviewed platform
// rules are ever readable. The engine itself lands in #940; the gate is the existing flag
// `limitation.enabled`.
import { z } from 'zod';

/** What starts the clock for a rule. These mirror the CHECK lists in `packages/db/src/schema/limitation.ts`. */
export const LIMITATION_START_EVENTS = [
  'cause_of_action',
  'knowledge',
  'order_date',
  'filing_date',
  'custom',
] as const;
export type LimitationStartEvent = (typeof LIMITATION_START_EVENTS)[number];

export const LIMITATION_PERIOD_UNITS = ['days', 'months', 'years'] as const;
export type LimitationPeriodUnit = (typeof LIMITATION_PERIOD_UNITS)[number];

export const LIMITATION_COMPUTATION_STATUSES = ['proposed', 'confirmed', 'superseded'] as const;
export type LimitationComputationStatus = (typeof LIMITATION_COMPUTATION_STATUSES)[number];

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const Code = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, 'lowercase dotted code');

/** One limitation rule: a period that runs from an event, with its source citation. */
export const LimitationRule = z
  .object({
    code: Code,
    title: z.string().min(1).max(300),
    statute: z.string().min(1).max(300),
    periodValue: z.number().int().positive(),
    periodUnit: z.enum(LIMITATION_PERIOD_UNITS),
    startEvent: z.enum(LIMITATION_START_EVENTS),
    condonable: z.boolean().default(true),
    citation: z.string().max(1000).optional(),
  })
  .strict();
export type LimitationRule = z.infer<typeof LimitationRule>;

/** A counsel-supplied table of rules; codes are unique within it. */
export const RuleTable = z
  .object({
    version: z.string().min(1).max(50),
    rules: z.array(LimitationRule).min(1),
  })
  .strict()
  .refine((t) => new Set(t.rules.map((r) => r.code)).size === t.rules.length, {
    message: 'duplicate rule code',
    path: ['rules'],
  });
export type RuleTable = z.infer<typeof RuleTable>;

/** What a computation starts from: a matter, a rule and the date the clock starts. */
export const ComputationInput = z
  .object({
    matterId: z.uuid(),
    ruleCode: Code,
    startDate: IsoDate,
    /** Days excluded from the period (for example time spent obtaining a certified copy). */
    excludedDays: z.number().int().min(0).default(0),
  })
  .strict();
export type ComputationInput = z.infer<typeof ComputationInput>;

/** The computed outcome. `expiresOn` is the last day to file. */
export const ComputationResult = z
  .object({
    ruleCode: Code,
    startDate: IsoDate,
    expiresOn: IsoDate,
    status: z.enum(LIMITATION_COMPUTATION_STATUSES),
    notes: z.array(z.string().max(500)).default([]),
  })
  .strict();
export type ComputationResult = z.infer<typeof ComputationResult>;
