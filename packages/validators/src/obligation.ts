// Obligation service inputs (#67; ADR 0043): the zod inputs of the `@causedeck/core` obligation
// service (create, patch, close, reopen, reconcile, defects, certified copies, the queue). The
// service parses every input with these before touching the database. Objects are strict. Names
// follow the stored columns: the issue's `closed` is the status `done` (or `not_applicable`), its
// `completed_task` reason is `task_completed` and its `kind` is `source`.
import { z } from 'zod';

import {
  OBLIGATION_CLOSED_REASON_TYPES,
  OBLIGATION_SOURCES,
  ProvenanceSchema,
} from './matter-graph';

const uuid = z.uuid();
const day = z.iso.date();
const text = z.string().trim().min(1, 'Must not be blank');

/** The queue groups, in the order the queue lists them. */
export const QUEUE_GROUPS = ['overdue', 'today', 'this_week', 'later', 'undated'] as const;
export type QueueGroup = (typeof QUEUE_GROUPS)[number];

/** The source of a fact must be named: a non-manual source needs an anchor or a source reference. */
export const ObligationInput = z.strictObject({
  matterId: uuid,
  proceedingId: uuid.nullable().optional(),
  source: z.enum(OBLIGATION_SOURCES),
  description: text,
  /** Null only for an undated task. */
  dueDate: day.nullable(),
  basis: text.nullable().optional(),
  ownerMemberId: uuid,
  sourceOrderId: uuid.nullable().optional(),
  provenance: ProvenanceSchema,
});

export const ObligationPatch = z
  .strictObject({
    description: text.optional(),
    /** Marks the description as strategy-bearing: hidden from clerks. Owner or advocate only. */
    strategy: z.boolean().optional(),
    basis: text.nullable().optional(),
    ownerMemberId: uuid.optional(),
    /** Moving the date is a reschedule: it needs `reason`. */
    dueDate: day.nullable().optional(),
    reason: text.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.values(value).every((v) => v === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Nothing to update' });
    }
    if (value.dueDate !== undefined && value.reason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Rescheduling needs a reason',
      });
    }
  });

/** Closure is always deliberate: a reason type, and a note when the obligation does not apply. */
export const CloseInput = z
  .strictObject({
    reason: z.enum(OBLIGATION_CLOSED_REASON_TYPES),
    note: text.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reason === 'not_applicable' && value.note === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Not applicable needs a reason in words',
      });
    }
  });

export const ReopenInput = z.strictObject({ reason: text });

export const ReconcileInput = z.strictObject({
  orderId: uuid,
});

/** Mark one direction of an order (by its anchor) as not applicable, in words. */
export const DirectionNotApplicableInput = z.strictObject({
  orderId: uuid,
  anchorId: uuid,
  reason: text,
});

export const DefectInput = z.strictObject({
  proceedingId: uuid,
  raisedOn: day,
  cureBy: day,
  description: text,
  ownerMemberId: uuid,
  provenance: ProvenanceSchema,
});

export const CureDefectInput = z.strictObject({
  defectId: uuid,
  curedOn: day,
  note: text.optional(),
});

export const RepresentFilingInput = z.strictObject({
  proceedingId: uuid,
  reason: text.optional(),
  /** The registry's allocation, stored on the proceeding; it says nothing about court status. */
  srNo: text.optional(),
  frNo: text.optional(),
});

/** Record the SR (Madras) or FR (Karnataka) number the registry allocated. */
export const AllocateRegistryNumberInput = z
  .strictObject({
    proceedingId: uuid,
    srNo: text.optional(),
    frNo: text.optional(),
  })
  .refine((v) => v.srNo !== undefined || v.frNo !== undefined, {
    message: 'Give an SR or an FR number',
  });

export const CertifiedCopyInput = z.strictObject({
  proceedingId: uuid,
  matterId: uuid,
  appliedOn: day,
  description: text,
  ownerMemberId: uuid,
  followUpOn: day.nullable().optional(),
  provenance: ProvenanceSchema,
});

export const CopyTransitionInput = z.strictObject({
  certifiedCopyId: uuid,
  to: z.enum(['ready', 'collected']),
  on: day,
  /** Where the step was learned (a registry note, a receipt). */
  sourceRef: text,
});

export const QueueQuery = z.strictObject({
  matterId: uuid.optional(),
  ownerMemberId: uuid.optional(),
  source: z.enum(OBLIGATION_SOURCES).optional(),
  sourceType: ProvenanceSchema.shape.sourceType.optional(),
  /** Per group page size. */
  limit: z.int().min(1).max(200).default(100),
});

export const MissedQuery = z.strictObject({
  from: day,
  to: day,
});

export type ObligationInput = z.input<typeof ObligationInput>;
export type ParsedObligation = z.output<typeof ObligationInput>;
export type ObligationPatch = z.input<typeof ObligationPatch>;
export type CloseInput = z.input<typeof CloseInput>;
export type ReopenInput = z.input<typeof ReopenInput>;
export type ReconcileInput = z.input<typeof ReconcileInput>;
export type DirectionNotApplicableInput = z.input<typeof DirectionNotApplicableInput>;
export type DefectInput = z.input<typeof DefectInput>;
export type CureDefectInput = z.input<typeof CureDefectInput>;
export type RepresentFilingInput = z.input<typeof RepresentFilingInput>;
export type AllocateRegistryNumberInput = z.input<typeof AllocateRegistryNumberInput>;
export type CertifiedCopyInput = z.input<typeof CertifiedCopyInput>;
export type CopyTransitionInput = z.input<typeof CopyTransitionInput>;
export type QueueQuery = z.input<typeof QueueQuery>;
export type ParsedQueueQuery = z.output<typeof QueueQuery>;
export type MissedQuery = z.input<typeof MissedQuery>;
