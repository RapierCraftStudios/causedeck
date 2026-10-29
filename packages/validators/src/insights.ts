// Practice insights (#85): the zod query and result shapes of the in-workspace practice report
// (Prepared & Kept, obligation health, preparedness and load series). Every figure is computed
// from the signed-in workspace's own rows; nothing here compares lawyers or workspaces, and there
// is no bench or judge dimension.
import { z } from 'zod';

/** A calendar day, `YYYY-MM-DD` (IST). */
export const InsightsDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** The longest custom range, in days. */
export const INSIGHTS_MAX_RANGE_DAYS = 366;

/** A series with fewer ratings than this is hidden with an explanation. */
export const INSIGHTS_MIN_N = 5;

export const INSIGHTS_RANGES = ['4w', '12w', 'custom'] as const;
export type InsightsRangeKey = (typeof INSIGHTS_RANGES)[number];

/** The range picker's choice; `custom` needs both days. `memberId` narrows to one member. */
export const InsightsQuery = z
  .object({
    range: z.enum(INSIGHTS_RANGES).default('12w'),
    from: InsightsDay.optional(),
    to: InsightsDay.optional(),
    memberId: z.uuid().optional(),
  })
  .strict()
  .refine((q) => q.range !== 'custom' || (q.from !== undefined && q.to !== undefined), {
    message: 'A custom range needs from and to',
    path: ['from'],
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from is after to',
    path: ['from'],
  });
export type InsightsQuery = z.infer<typeof InsightsQuery>;

/** A resolved range: both ends inclusive, IST days. */
export const InsightsWindow = z.object({ from: InsightsDay, to: InsightsDay });
export type InsightsWindow = z.infer<typeof InsightsWindow>;

const Rate = z.number().min(0).max(1).nullable();

export const PreparedKeptWeek = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  numerator: z.number().int().min(0),
  denominator: z.number().int().min(0),
  rate: Rate,
});

export const PreparedKept = z.object({
  window: InsightsWindow,
  numerator: z.number().int().min(0),
  denominator: z.number().int().min(0),
  rate: Rate,
  /** Held appearances whose obligations are not yet decided (counted in neither). */
  pending: z.number().int().min(0),
  weeks: z.array(PreparedKeptWeek),
  previous: z.object({
    window: InsightsWindow,
    numerator: z.number().int().min(0),
    denominator: z.number().int().min(0),
    rate: Rate,
  }),
});
export type PreparedKept = z.infer<typeof PreparedKept>;

export const ObligationHealth = z.object({
  window: InsightsWindow,
  /** Obligations due in the range, up to today. */
  due: z.number().int().min(0),
  kept: z.number().int().min(0),
  /** Overdue and open without a deliberate reschedule. */
  missed: z.number().int().min(0),
  missedRate: Rate,
  keptRate: Rate,
  /** Of the obligations arising from orders in the range: owned and dated. */
  capturedTotal: z.number().int().min(0),
  captured: z.number().int().min(0),
  captureCompleteness: Rate,
  /** Reschedule events (each carries its reason) in the range; never a miss. */
  deliberateReschedules: z.number().int().min(0),
});
export type ObligationHealth = z.infer<typeof ObligationHealth>;

const Score = z.number().min(1).max(5).nullable();

export const PreparednessPoint = z.object({
  week: z.string(),
  n: z.number().int().min(0),
  average: Score,
});
export const PreparednessSeries = z.object({
  window: InsightsWindow,
  n: z.number().int().min(0),
  /** True when n is below {@link INSIGHTS_MIN_N}: the numbers are withheld. */
  hidden: z.boolean(),
  average: Score,
  baselineAverage: Score,
  /** Average minus the baseline average, one decimal. */
  delta: z.number().nullable(),
  points: z.array(PreparednessPoint),
});
export type PreparednessSeries = z.infer<typeof PreparednessSeries>;

export const LoadPoint = z.object({
  week: z.string(),
  n: z.number().int().min(0),
  demand: Score,
  worry: Score,
  effort: Score,
});
export const LoadSeries = z.object({
  window: InsightsWindow,
  n: z.number().int().min(0),
  hidden: z.boolean(),
  demand: Score,
  worry: Score,
  effort: Score,
  /** Average of the three items minus the baseline average of the three, one decimal. */
  delta: z.number().nullable(),
  baselineAverage: Score,
  points: z.array(LoadPoint),
});
export type LoadSeries = z.infer<typeof LoadSeries>;

export const PracticeInsights = z.object({
  computedAt: z.string(),
  /** `workspace` totals (owner, advocate) or `own` appearances only (junior). */
  scope: z.enum(['workspace', 'own']),
  preparedKept: PreparedKept,
  obligations: ObligationHealth,
  preparedness: PreparednessSeries,
  load: LoadSeries,
});
export type PracticeInsights = z.infer<typeof PracticeInsights>;
