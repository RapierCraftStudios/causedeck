// Attention schemas (#70): the shapes of the `@causedeck/core` attention service (`detectAttention`,
// snooze and dismiss). A flag is rule-based and explainable: it names its rule, its evidence and
// the date it has held since, and suggests an action as text; nothing here changes data. Objects
// are strict and no type is `any`.
import { z } from 'zod';

const uuid = z.uuid();
const day = z.iso.date();
const text = z.string().trim().min(1, 'Must not be blank');

/** The rules of the detector, in the order the Needs-you panel groups them. */
export const ATTENTION_RULES = [
  'no_next_date',
  'past_date_no_outcome',
  'no_recent_update',
  'obligation_overdue_unowned',
] as const;
export type AttentionRule = (typeof ATTENTION_RULES)[number];

/** What a flag suggests a person does; the suggestion is text and never runs by itself. */
export const ATTENTION_ACTIONS = ['record_outcome', 'set_next_date', 'ask_junior'] as const;
export type AttentionAction = (typeof ATTENTION_ACTIONS)[number];

/** Bounds and default of the workspace's stale-matter threshold in days (`attention.stale_days`). */
export const ATTENTION_STALE_DAYS_MIN = 7;
export const ATTENTION_STALE_DAYS_MAX = 180;
export const ATTENTION_STALE_DAYS_DEFAULT = 30;

export const AttentionFlag = z.strictObject({
  /** Stable per matter, rule and subject, so a list can key on it. */
  key: z.string().min(1),
  matterId: uuid,
  matterTitle: z.string(),
  rule: z.enum(ATTENTION_RULES),
  /** Why the flag was raised, in words; clerks get the date-only form (no strategy-bearing text). */
  evidence: z.string().min(1),
  /** The court day (or day) the condition has held since. */
  since: day,
  suggestedAction: z.string().min(1),
  actionKind: z.enum(ATTENTION_ACTIONS),
  /** The listing or obligation the flag is about; null for a matter-level rule. */
  subjectId: uuid.nullable(),
});
export type AttentionFlag = z.infer<typeof AttentionFlag>;

export const AttentionQuery = z.strictObject({
  matterId: uuid.optional(),
  rules: z.array(z.enum(ATTENTION_RULES)).min(1).optional(),
});
export type AttentionQuery = z.infer<typeof AttentionQuery>;

/**
 * Snooze a rule (or every rule when `rule` is null) on a matter until a day, with a reason, or
 * dismiss it as intentionally dormant. A dismissal lapses when the matter gets a new event.
 */
export const Snooze = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('snooze'),
    matterId: uuid,
    rule: z.enum(ATTENTION_RULES).nullable().default(null),
    until: day,
    reason: text.max(500),
  }),
  z.strictObject({
    kind: z.literal('dismiss'),
    matterId: uuid,
    rule: z.enum(ATTENTION_RULES).nullable().default(null),
    reason: text.max(500).optional(),
  }),
]);
export type Snooze = z.infer<typeof Snooze>;

export const SnoozeRecord = z.strictObject({
  id: uuid,
  matterId: uuid,
  rule: z.enum(ATTENTION_RULES).nullable(),
  until: day.nullable(),
  dismissed: z.boolean(),
  reason: z.string().nullable(),
  createdBy: uuid.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type SnoozeRecord = z.infer<typeof SnoozeRecord>;

export const LiftSnoozeInput = z.strictObject({ snoozeId: uuid });
export type LiftSnoozeInput = z.infer<typeof LiftSnoozeInput>;

export const StaleDaysInput = z.strictObject({
  days: z.number().int().min(ATTENTION_STALE_DAYS_MIN).max(ATTENTION_STALE_DAYS_MAX),
});
export type StaleDaysInput = z.infer<typeof StaleDaysInput>;
