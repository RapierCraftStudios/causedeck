// Brief schemas (#60): the shapes of the `@causedeck/core` brief services (`assembleBrief`,
// `computeReadiness`, `markPrepared`, `setCarryItem`, `setBriefNote`). The brief is a derived view:
// every line carries its provenance (`source_type`, `source_ref`, `anchor_id` or manual, `confidence`,
// `confirmation_state`) and a line without provenance is never emitted, so `BriefLine` refuses it.
// Objects are strict. No `any`.
import { z } from 'zod';

const uuid = z.uuid();
const day = z.iso.date();

export const BRIEF_SOURCE_TYPES = [
  'manual',
  'document',
  'capture',
  'adapter',
  'ai',
  'import',
  'system',
] as const;
export const BRIEF_CONFIRMATION_STATES = [
  'proposed',
  'confirmed',
  'auto_applied',
  'corrected',
] as const;
export const BRIEF_SECTION_KEYS = [
  'stage',
  'last_order',
  'obligations',
  'carry',
  'synopsis',
  'last_hearing',
  'court_notes',
  'context',
] as const;
export const READINESS_SEGMENTS = [
  'stage_known',
  'last_order_confirmed',
  'obligations_reconciled',
  'carry_reviewed',
] as const;
export const CARRY_KINDS = ['document', 'rule', 'manual'] as const;
export const MAX_CONTEXT_PASSAGES = 5;

const confidence = z.number().min(0).max(1).nullable();

const provenanceFields = {
  source_type: z.enum(BRIEF_SOURCE_TYPES),
  source_ref: z.string().min(1).nullable(),
  /** The anchor the line cites, or null for a manual line / one that cites a source reference. */
  anchor_id: uuid.nullable(),
  confidence,
  confirmation_state: z.enum(BRIEF_CONFIRMATION_STATES),
};

/** A non-manual line must cite an anchor or a source reference: no provenance, no line. */
export function hasProvenance(line: {
  source_type: string;
  source_ref: string | null;
  anchor_id: string | null;
}): boolean {
  return line.source_type === 'manual' || line.anchor_id !== null || line.source_ref !== null;
}

const provenanceRule = {
  message: 'A line needs an anchor or a source reference unless it is manual',
  path: ['anchor_id'],
};

export const BriefLine = z
  .strictObject({
    text: z.string().min(1),
    /** 'Unconfirmed' when the line rests on an unconfirmed extraction. */
    label: z.string().min(1).nullable(),
    /** The cited page (the page-anchored link), when the line has an anchor. */
    page_no: z.int().min(1).nullable(),
    quote: z.string().nullable(),
    ...provenanceFields,
  })
  .refine(hasProvenance, provenanceRule);
export type BriefLine = z.infer<typeof BriefLine>;

export const ObligationLine = z
  .strictObject({
    obligation_id: uuid,
    /** e.g. 'counter not yet filed; due 20 Oct'. */
    text: z.string().min(1),
    owner_member_id: uuid.nullable(),
    due_date: day.nullable(),
    status: z.literal('open'),
    overdue: z.boolean(),
    ...provenanceFields,
  })
  .refine(hasProvenance, provenanceRule);
export type ObligationLine = z.infer<typeof ObligationLine>;

export const CarryItem = z.strictObject({
  /** `doc:<id>`, `rule:<id>` or `manual:<id>`. */
  key: z.string().min(1).max(200),
  kind: z.enum(CARRY_KINDS),
  label: z.string().min(1).max(500),
  document_id: uuid.nullable(),
  ticked: z.boolean(),
});
export type CarryItem = z.infer<typeof CarryItem>;

export const ContextPassage = z.strictObject({
  document_id: uuid,
  anchor_id: uuid.nullable(),
  page_no: z.int().min(1),
  quote: z.string().min(1),
});
export type ContextPassage = z.infer<typeof ContextPassage>;

export const SynopsisSection = z.strictObject({
  line: BriefLine,
  /** Present only for a role that holds `strategy.read`. */
  strategy: BriefLine.nullable(),
});
export type SynopsisSection = z.infer<typeof SynopsisSection>;

export const BriefSection = z.strictObject({
  key: z.enum(BRIEF_SECTION_KEYS),
  lines: z.array(BriefLine),
});
export type BriefSection = z.infer<typeof BriefSection>;

export const PreparedMark = z.strictObject({ by: uuid.nullable(), at: z.iso.datetime() });
export type PreparedMark = z.infer<typeof PreparedMark>;

export const Brief = z.strictObject({
  listing_id: uuid,
  matter_id: uuid,
  proceeding_id: uuid,
  assembled_at: z.iso.datetime(),
  /** AI-off matter: no AI compression and no embedding/full-text context retrieval. */
  sensitive: z.boolean(),
  ai_used: z.boolean(),
  stage: BriefLine.nullable(),
  last_order: z.array(BriefLine),
  obligations: z.strictObject({
    open: z.array(ObligationLine),
    closed_count: z.int().min(0),
  }),
  carry: z.array(CarryItem),
  synopsis: SynopsisSection.nullable(),
  last_hearing: BriefLine.nullable(),
  /** Omitted (null) for a role without `memory.read` and `strategy.read`. */
  court_notes: z.array(BriefLine).nullable(),
  context: z.array(ContextPassage).max(MAX_CONTEXT_PASSAGES),
  prepared: PreparedMark.nullable(),
  note: z.string().nullable(),
  carry_reviewed: z.boolean(),
});
export type Brief = z.infer<typeof Brief>;

export const Readiness = z.strictObject({
  score: z.int().min(0).max(100),
  segments: z.strictObject({
    stage_known: z.boolean(),
    last_order_confirmed: z.boolean(),
    obligations_reconciled: z.boolean(),
    carry_reviewed: z.boolean(),
  }),
  /** One human-readable reason per missing segment. */
  reasons: z.array(z.strictObject({ segment: z.enum(READINESS_SEGMENTS), reason: z.string() })),
});
export type Readiness = z.infer<typeof Readiness>;

/** The stored lawyer-authored state of a brief (`brief_state`). */
export const BriefState = z.strictObject({
  listing_id: uuid,
  prepared_by: uuid.nullable(),
  prepared_at: z.iso.datetime().nullable(),
  carry: z.array(
    z.strictObject({
      key: z.string().min(1).max(200),
      manual: z.boolean(),
      label: z.string().min(1).max(500).nullable(),
      ticked: z.boolean(),
      removed: z.boolean(),
    }),
  ),
  note: z.string().nullable(),
});
export type BriefState = z.infer<typeof BriefState>;

export const MarkPreparedInput = z.strictObject({ listingId: uuid });
export type MarkPreparedInput = z.infer<typeof MarkPreparedInput>;

export const SetCarryItemInput = z.discriminatedUnion('action', [
  z.strictObject({
    listingId: uuid,
    action: z.literal('add'),
    label: z.string().trim().min(1).max(500),
  }),
  z.strictObject({ listingId: uuid, action: z.literal('remove'), key: z.string().min(1).max(200) }),
  z.strictObject({
    listingId: uuid,
    action: z.literal('tick'),
    key: z.string().min(1).max(200),
    ticked: z.boolean(),
  }),
  z.strictObject({ listingId: uuid, action: z.literal('review') }),
]);
export type SetCarryItemInput = z.infer<typeof SetCarryItemInput>;

export const SetBriefNoteInput = z.strictObject({
  listingId: uuid,
  note: z.string().trim().max(5000).nullable(),
});
export type SetBriefNoteInput = z.infer<typeof SetBriefNoteInput>;
