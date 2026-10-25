// The hearing outcome contract (#62, PRD EX-3). `OutcomeProposal` is what the confirmation screen
// reads: every line carries its provenance (the transcript span or order line it rests on). The
// next date is L2: a proposed date with no anchor is not a proposal at all, so it can only be typed
// by a person (`manual`). `OutcomeConfirmation` is what the lawyer decided; nothing here applies
// anything, and a next date always needs an explicit human resolution.
import { z } from 'zod';

const uuid = z.uuid();
const day = z.iso.date();
const text = z.string().trim().min(1, 'Must not be blank');

export const OUTCOME_LANGUAGES = ['en', 'ta', 'kn'] as const;
export const OUTCOME_LINE_SOURCES = ['voice', 'order', 'manual'] as const;
export const OUTCOME_STATES = ['processing', 'ready', 'needs_you', 'empty'] as const;

/** A value with where it came from; `anchorId` is the transcript span or order line. */
export const Line = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value,
    anchorId: uuid,
    quote: z.string().nullable().default(null),
    source: z.enum(OUTCOME_LINE_SOURCES),
  });

const ObligationProposal = z.strictObject({
  proposalId: uuid,
  description: text,
  dueDate: day.nullable().default(null),
  basis: z.string().nullable().default(null),
  anchorId: uuid.nullable().default(null),
  quote: z.string().nullable().default(null),
  ownerMemberId: uuid.nullable().default(null),
});

const TaskProposal = z.strictObject({
  proposalId: uuid,
  title: text,
  anchorId: uuid.nullable().default(null),
  quote: z.string().nullable().default(null),
});

/** The date the existing canonical listing holds, set against the proposed one on the card. */
const NextDateConflict = z.strictObject({
  currentListingId: uuid,
  currentDate: day,
  currentSource: z.string(),
  proposedListingId: uuid.nullable().default(null),
  proposedDate: day,
});

export const OutcomeProposal = z.strictObject({
  hearingId: uuid,
  matterId: uuid,
  proceedingId: uuid,
  heldOn: day,
  state: z.enum(OUTCOME_STATES),
  summary: Line(text).optional(),
  adjournmentReason: Line(text).optional(),
  nextDate: Line(day).optional(),
  stageAfter: Line(text).optional(),
  conflict: NextDateConflict.nullable().default(null),
  obligations: z.array(ObligationProposal).default([]),
  tasks: z.array(TaskProposal).default([]),
  transcriptRef: z.strictObject({ documentId: uuid, language: z.enum(OUTCOME_LANGUAGES) }).nullable(),
  language: z.enum(OUTCOME_LANGUAGES),
  /** Whether the hearing already has a confirmed outcome. */
  confirmed: z.boolean().default(false),
});

/** How the lawyer resolved the next date; the confirm bar stays disabled until one is chosen. */
export const NextDateResolution = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('date'),
    date: day,
    /** `proposal`: the date of an anchored proposal; `manual`: typed by the lawyer. */
    source: z.enum(['proposal', 'manual']),
  }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('to_be_notified') }),
]);

/** What a conflict card's radio picked; required while the proposal differs from the canonical date. */
export const ConflictChoice = z.enum(['current', 'proposed']);

const Reason = z.string().trim().min(1, 'Give a reason, or mark it not applicable').max(500);

const ObligationDecision = z
  .strictObject({
    /** Null for an obligation the lawyer typed in. */
    proposalId: uuid.nullable().default(null),
    action: z.enum(['confirm', 'edit', 'dismiss']),
    description: text.max(2000).optional(),
    dueDate: day.nullable().optional(),
    ownerMemberId: uuid.nullable().optional(),
    reason: Reason.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'dismiss') {
      if (value.reason === undefined) {
        ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give a reason, or mark it not applicable' });
      }
    } else if (value.proposalId === null && value.description === undefined) {
      ctx.addIssue({ code: 'custom', path: ['description'], message: 'Describe the obligation' });
    }
  });

const TaskDecision = z
  .strictObject({
    proposalId: uuid.nullable().default(null),
    action: z.enum(['confirm', 'edit', 'dismiss']),
    title: text.max(500).optional(),
    dueDate: day.nullable().optional(),
    reason: Reason.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'dismiss' && value.reason === undefined) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give a reason, or mark it not applicable' });
    }
    if (value.action !== 'dismiss' && value.proposalId === null && value.title === undefined) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'Name the task' });
    }
  });

export const OutcomeConfirmation = z.strictObject({
  hearingId: uuid,
  /** What happened, as the lawyer confirms it. */
  outcome: text.max(5000),
  adjournmentReason: z.string().trim().max(500).optional(),
  stageAfter: z.string().trim().max(200).optional(),
  nextDate: NextDateResolution,
  conflictChoice: ConflictChoice.optional(),
  obligations: z.array(ObligationDecision).max(50).default([]),
  tasks: z.array(TaskDecision).max(50).default([]),
});

/** The L0 path: a typed note and a next date, with no proposals to decide. */
export const ManualOutcomeInput = OutcomeConfirmation.omit({ obligations: true, tasks: true });

/**
 * The reason a next date cannot be accepted, or `null`. A `proposal` date must be one of the dates
 * the anchored sources carry; anything else can only be entered manually (`source: 'manual'`).
 */
export function nextDateRejection(
  nextDate: z.infer<typeof NextDateResolution>,
  anchoredDates: readonly string[],
): string | null {
  if (nextDate.kind !== 'date' || nextDate.source === 'manual') return null;
  return anchoredDates.includes(nextDate.date)
    ? null
    : 'This date is not in the voice note or the order. Enter it yourself to confirm it.';
}

export type OutcomeProposal = z.output<typeof OutcomeProposal>;
export type NextDateResolution = z.infer<typeof NextDateResolution>;
export type ConflictChoice = z.infer<typeof ConflictChoice>;
export type OutcomeConfirmation = z.input<typeof OutcomeConfirmation>;
export type ParsedOutcomeConfirmation = z.output<typeof OutcomeConfirmation>;
export type ManualOutcomeInput = z.input<typeof ManualOutcomeInput>;
export type ObligationDecision = z.input<typeof ObligationDecision>;
export type TaskDecision = z.input<typeof TaskDecision>;
