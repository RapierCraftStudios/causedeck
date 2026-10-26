// Continuity schemas (#71): the shapes of the `@causedeck/core` continuity services
// (`generateHandover`, `saveHandover`, `acknowledgeHandover`, `recordView`, `whatChangedSince`).
// Handover and what-changed are derived views over the graph and memory; every line reuses the brief
// line, so a line without provenance is refused. Handover is internal to the workspace: nothing here
// models a share link, an email or an export. Objects are strict. No `any`.
import { z } from 'zod';

import { BriefLine, ObligationLine } from './brief';

const uuid = z.uuid();
const day = z.iso.date();

/** What an empty open-questions list reads as. */
export const NONE_RECORDED = 'None recorded';
export const MAX_HANDOVER_ORDERS = 3;
export const MAX_ORDER_LINES = 2;
export const MAX_OPEN_QUESTIONS = 20;
export const MAX_SECTION_EDIT = 4000;
export const MAX_QUESTION_LENGTH = 500;
/** `recordView` writes at most once in this window per matter and member. */
export const VIEW_DEBOUNCE_SECONDS = 30;

export const HANDOVER_SECTIONS = [
  'where_it_stands',
  'last_orders',
  'open_obligations',
  'coming_up',
  'key_documents',
  'open_questions',
] as const;
export type HandoverSection = (typeof HANDOVER_SECTIONS)[number];

export const HandoverStage = z.strictObject({ proceeding_id: uuid, line: BriefLine });
export type HandoverStage = z.infer<typeof HandoverStage>;

export const HandoverOrder = z.strictObject({
  order_id: uuid,
  order_date: day,
  /** Up to two lines, each with its page anchor. */
  lines: z.array(BriefLine).max(MAX_ORDER_LINES),
});
export type HandoverOrder = z.infer<typeof HandoverOrder>;

export const HandoverListing = z.strictObject({
  listing_id: uuid,
  list_date: day,
  line: BriefLine,
});
export type HandoverListing = z.infer<typeof HandoverListing>;

/** The derived content of a handover. A strategy synopsis and memory appear only for a role that may read them. */
export const HandoverBody = z.strictObject({
  matter_id: uuid,
  generated_at: z.iso.datetime(),
  synopsis: BriefLine.nullable(),
  stages: z.array(HandoverStage),
  last_orders: z.array(HandoverOrder).max(MAX_HANDOVER_ORDERS),
  open_obligations: z.array(ObligationLine),
  coming_up: z.array(HandoverListing),
  key_documents: z.array(BriefLine),
  /** Lawyer-authored or confirmed: never invented. */
  open_questions: z.array(BriefLine).max(MAX_OPEN_QUESTIONS),
  /** 'None recorded' when `open_questions` is empty, else null. */
  open_questions_label: z.literal(NONE_RECORDED).nullable(),
});
export type HandoverBody = z.infer<typeof HandoverBody>;

/** The lawyer's text edits per section, kept next to the derived content. */
export const HandoverEdits = z.partialRecord(z.enum(HANDOVER_SECTIONS), z.string().max(MAX_SECTION_EDIT));
export type HandoverEdits = z.infer<typeof HandoverEdits>;

export const HandoverContent = z.strictObject({ derived: HandoverBody, edits: HandoverEdits });
export type HandoverContent = z.infer<typeof HandoverContent>;

export const HandoverNote = z.strictObject({
  id: uuid,
  matter_id: uuid,
  version: z.int().min(1),
  author_id: uuid.nullable(),
  recipient_id: uuid.nullable(),
  body: HandoverContent,
  acknowledged_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
});
export type HandoverNote = z.infer<typeof HandoverNote>;

export const GenerateHandoverInput = z.strictObject({ matterId: uuid });
export type GenerateHandoverInput = z.infer<typeof GenerateHandoverInput>;

/**
 * Saving takes only what the author wrote: section edits and open questions. The derived content is
 * regenerated server-side, so a client cannot store a line without provenance or one it may not read.
 */
export const SaveHandoverInput = z.strictObject({
  matterId: uuid,
  recipientMemberId: uuid,
  edits: HandoverEdits.default({}),
  openQuestions: z.array(z.string().trim().min(1).max(MAX_QUESTION_LENGTH)).max(MAX_OPEN_QUESTIONS).default([]),
});
export type SaveHandoverInput = z.input<typeof SaveHandoverInput>;

export const AcknowledgeHandoverInput = z.strictObject({ handoverId: uuid });
export type AcknowledgeHandoverInput = z.infer<typeof AcknowledgeHandoverInput>;

export const ListHandoversInput = z.strictObject({ matterId: uuid });
export type ListHandoversInput = z.infer<typeof ListHandoversInput>;

export const HandoverBulkInput = z.strictObject({
  fromMemberId: uuid,
  toMemberId: uuid,
});
export type HandoverBulkInput = z.infer<typeof HandoverBulkInput>;

export const CHANGE_KINDS = [
  'order',
  'hearing',
  'listing',
  'next_date',
  'obligation',
  'document',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const ChangeItem = z.strictObject({
  kind: z.enum(CHANGE_KINDS),
  at: z.iso.datetime(),
  /** The member who made the change, when the source records one (obligation changes); else null. */
  actor_member_id: uuid.nullable(),
  line: BriefLine,
});
export type ChangeItem = z.infer<typeof ChangeItem>;

export const ChangeGroup = z.strictObject({ day, items: z.array(ChangeItem).min(1) });
export type ChangeGroup = z.infer<typeof ChangeGroup>;

export const ChangeSummary = z.strictObject({
  matter_id: uuid,
  since: z.iso.datetime(),
  /** Whole days between `since` and now. */
  days_ago: z.int().min(0),
  /** Chronological day groups, oldest first. */
  groups: z.array(ChangeGroup),
  total: z.int().min(0),
});
export type ChangeSummary = z.infer<typeof ChangeSummary>;

export const WhatChangedInput = z.strictObject({ matterId: uuid, since: z.coerce.date() });
export type WhatChangedInput = z.infer<typeof WhatChangedInput>;

export const RecordViewInput = z.strictObject({ matterId: uuid });
export type RecordViewInput = z.infer<typeof RecordViewInput>;

/** The viewer's marker: the previous view (null on the first ever) and whether this call wrote. */
export const ViewMarker = z.strictObject({
  matter_id: uuid,
  previous_viewed_at: z.iso.datetime().nullable(),
  viewed_at: z.iso.datetime(),
  recorded: z.boolean(),
});
export type ViewMarker = z.infer<typeof ViewMarker>;
