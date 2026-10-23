// The `ProposalDraft` contract (#47, #46): what every source (documents, voice, calendar, email,
// lists) hands the automation engine. A draft says what should change and why it is believed; it
// changes nothing by itself. The engine (`@causedeck/core` automation) validates each draft with
// `ProposalDraftSchema`, routes it to a level and, at most, applies it. There is no draft kind for
// sending, filing, paying, advising, accepting an engagement or inserting a citation: the closed
// `PROPOSAL_KINDS` list below is the only way a change enters the system (PRD TR-1, TR-2).
import { z } from 'zod';

/** Every kind of change a draft may propose. `memory_item` and `fee_entry` wait for #72 and #83. */
export const PROPOSAL_KINDS = [
  'next_date',
  'hearing_outcome',
  'new_matter',
  'new_proceeding',
  'listing_update',
  'task',
  'obligation_from_direction',
  'document_attach',
  'order_record',
  'party_detail',
  'duplicate_merge',
  'memory_item',
  'fee_entry',
  'outward_draft',
  'case_status_change',
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/**
 * Where a draft came from. `ai` drafts name the `ai_call` that produced them (model, version and
 * region are read from it, never copied from the caller); `manual` and `deterministic` (rules,
 * parsers, court adapters) drafts involve no model.
 */
export const DRAFT_SOURCE_TYPES = ['manual', 'deterministic', 'ai'] as const;
export type DraftSourceType = (typeof DRAFT_SOURCE_TYPES)[number];

/** How a draft was matched to a record of the workspace, when it names an existing one. */
export const MATCH_EXACT_KEYS = ['case_number', 'cnr'] as const;

const uuid = z.uuid();

export const DraftSourceSchema = z.strictObject({
  type: z.enum(DRAFT_SOURCE_TYPES),
  /** The input kind: `document`, `voice`, `calendar`, `email`, `list`, `form`. */
  input: z.string().trim().min(1).max(40),
  /** The `ai_call` behind an `ai` draft. */
  aiCallId: uuid.nullable().optional(),
  /** An opaque reference to the input (a document id, a message id); never its content. */
  ref: z.string().trim().min(1).max(200).nullable().optional(),
});

export const DraftMatchSchema = z.strictObject({
  /** 0..1 similarity of the input to the matched record. */
  score: z.number().min(0).max(1),
  /** The identifier that matched exactly, if one did. */
  exact: z.enum(MATCH_EXACT_KEYS).nullable().optional(),
});

export const ProposalDraftSchema = z.strictObject({
  kind: z.enum(PROPOSAL_KINDS),
  /** The capture the draft came from; null for a draft typed in by hand. */
  captureId: uuid.nullable().optional(),
  source: DraftSourceSchema,
  /** The kind's own fields (validated again by the kind's handler). */
  payload: z.record(z.string(), z.unknown()),
  /** Anchors of the evidence in the source (`anchor.id`); an AI draft without one is unanchored. */
  anchors: z.array(uuid).max(50).default([]),
  /** 0..1, or null when the source gives none. */
  confidence: z.number().min(0).max(1).nullable().optional(),
  matterId: uuid.nullable().optional(),
  proceedingId: uuid.nullable().optional(),
  match: DraftMatchSchema.nullable().optional(),
  /** Groups drafts of one pattern for threshold learning, e.g. `listing:item_no`. */
  patternKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*(:[a-z0-9_]+)*$/)
    .max(80)
    .optional(),
  /** The source could not choose between candidates: always a card for the person. */
  ambiguous: z.boolean().optional(),
  /** A duplicate capture: `document.near_duplicate` or an identical sha256. */
  duplicate: z
    .strictObject({
      kind: z.enum(['near_duplicate', 'sha256']),
      ofDocumentId: uuid,
    })
    .nullable()
    .optional(),
});

export type ProposalDraft = z.input<typeof ProposalDraftSchema>;
export type ParsedProposalDraft = z.output<typeof ProposalDraftSchema>;
export type DraftSource = z.output<typeof DraftSourceSchema>;
export type DraftMatch = z.output<typeof DraftMatchSchema>;
