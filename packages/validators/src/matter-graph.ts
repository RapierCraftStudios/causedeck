// Matter-graph schemas (#349, part 6 of #32; ADR 0013): zod insert and select schemas for the graph
// tables of `@causedeck/db` (matter, documents, proceedings, docket, people, court reference tables)
// plus `ProvenanceSchema`. `@causedeck/db` depends on this package, so the schemas are written by
// hand rather than derived from the tables; packages/db/src/__tests__/matter-graph-validators.test.ts
// keeps them in step (keys, optional keys, enum values, select types).
//
// Keys are the Drizzle property names. Values follow Drizzle's runtime types: `date` columns are
// `YYYY-MM-DD` strings, `timestamptz` columns are `Date`s and `numeric` columns are decimal strings.
// A select schema lists every column; an insert schema makes a column optional where it is nullable
// or has a default. Insert schemas also mirror the table CHECKs that are cheap to state here, so a
// form or service rejects what the database would.
import { z } from 'zod';

export const SOURCE_TYPES = [
  'manual',
  'document',
  'capture',
  'adapter',
  'ai',
  'import',
  'system',
] as const;
export const CONFIRMATION_STATES = ['proposed', 'confirmed', 'auto_applied', 'corrected'] as const;
export const FORUM_SIDES = ['original', 'appellate', 'not_applicable'] as const;
export const JURISDICTION_KINDS = [
  'high_court',
  'district',
  'tribunal',
  'commission',
  'other',
] as const;
export const ADAPTER_LEVELS = ['A0', 'A1', 'A2', 'A3'] as const;
export const BENCH_KINDS = ['single', 'division', 'full', 'other'] as const;
export const PROCEEDING_KINDS = ['main', 'misc', 'appeal', 'connected'] as const;
export const PROCEEDING_STATES = [
  'filed',
  'sr_fr',
  'defects',
  're_presented',
  'numbered',
  'disposed',
] as const;
export const LIST_TYPES = ['daily', 'advance', 'supplementary', 'special'] as const;
export const APPEARANCE_CAPACITIES = ['aor', 'arguing', 'for_other', 'proxy', 'assisting'] as const;
export const ORDER_TYPES = ['interim', 'final', 'procedural'] as const;
export const OBLIGATION_SOURCES = [
  'order_direction',
  'rule',
  'registry_defect',
  'client',
  'internal',
  'certified_copy',
] as const;
export const OBLIGATION_STATUSES = ['open', 'done', 'not_applicable', 'superseded'] as const;
export const PERSON_KINDS = [
  'party',
  'advocate',
  'judge_staff',
  'client',
  'professional',
  'other',
] as const;
export const ROLE_EDGE_KINDS = [
  'represents',
  'appears_for',
  'instructed_by',
  'assigned_to',
  'opposes',
] as const;
export const DOCUMENT_KINDS = [
  'pleading',
  'ia',
  'annexure',
  'order',
  'judgment',
  'cause_list',
  'correspondence',
  'note',
  'draft',
  'registry_memo',
  'other',
] as const;
export const DOCUMENT_TEXT_STATUSES = ['pending', 'layer', 'ocr', 'failed', 'skipped'] as const;
export const MATTER_STATUSES = ['active', 'disposed', 'archived'] as const;
export const ANCHOR_KINDS = [
  'document',
  'transcript',
  'list_row',
  'calendar_event',
  'email',
  'image_region',
] as const;
export const PROCEEDING_LINK_KINDS = [
  'parent_of',
  'connected',
  'appeal_from',
  'lower_court',
] as const;
export const OBLIGATION_CLOSED_REASON_TYPES = [
  'task_completed',
  'lawyer_action',
  'not_applicable',
] as const;
export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;

/** The longest quote an anchor may store (characters). */
export const ANCHOR_QUOTE_MAX = 2000;
/** The CNR (case number record) format: 16 upper-case letters and digits. */
export const CNR_PATTERN = /^[A-Z0-9]{16}$/;

const uuid = z.uuid();
/** A Postgres `date` as Drizzle returns it. */
const day = z.iso.date();
const nonBlank = z.string().refine((value) => value.trim() !== '', 'Must not be blank');
/** A `numeric(4,3)` within 0..1, as Drizzle returns it (a decimal string). */
const unitInterval = z
  .string()
  .regex(/^\d(\.\d{1,3})?$/, 'A decimal with up to three places')
  .refine((value) => Number(value) >= 0 && Number(value) <= 1, 'Must lie within 0..1');

const timestamps = { createdAt: z.date(), updatedAt: z.date() };
/** Keys every graph table may leave to the database on insert. */
const GENERATED = { id: true, createdAt: true, updatedAt: true } as const;

const provenanceShape = {
  sourceType: z.enum(SOURCE_TYPES),
  sourceRef: z.string().nullable(),
  anchorId: uuid.nullable(),
  confidence: unitInterval.nullable(),
  confirmationState: z.enum(CONFIRMATION_STATES),
  capturedAt: z.date(),
};
const PROVENANCE_OPTIONAL = {
  sourceRef: true,
  anchorId: true,
  confidence: true,
  confirmationState: true,
  capturedAt: true,
} as const;

type Issues = z.core.$RefinementCtx;

/** `provenanceCheck()`: a non-manual fact points at its source (an anchor or a source reference). */
function checkProvenance(
  value: {
    sourceType: string;
    sourceRef?: string | null | undefined;
    anchorId?: string | null | undefined;
  },
  ctx: Issues,
): void {
  if (value.sourceType !== 'manual' && value.anchorId == null && value.sourceRef == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['anchorId'],
      message: 'A non-manual fact needs an anchorId or a sourceRef',
    });
  }
}

/** The six provenance columns every fact carries, with the `provenanceCheck()` rule. */
export const ProvenanceSchema = z
  .object(provenanceShape)
  .partial(PROVENANCE_OPTIONAL)
  .superRefine(checkProvenance);
export type Provenance = z.output<typeof ProvenanceSchema>;

// ---------------------------------------------------------------------------------------------
// Court reference tables (global-or-workspace: a null workspaceId is a catalogue row).

const forumShape = {
  id: uuid,
  workspaceId: uuid.nullable(),
  code: z.string().min(1),
  court: z.string().min(1),
  establishment: z.string().nullable(),
  seat: z.string().nullable(),
  side: z.enum(FORUM_SIDES),
  jurisdictionKind: z.enum(JURISDICTION_KINDS),
  languageProfile: z.object({
    primary: z.string().exactOptional(),
    secondary: z.array(z.string()).exactOptional(),
    ocr: z.array(z.string()).exactOptional(),
    stt: z.array(z.string()).exactOptional(),
  }),
  adapterId: z.string().nullable(),
  adapterLevel: z.enum(ADAPTER_LEVELS),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  ...timestamps,
};
export const ForumSelectSchema = z.object(forumShape);
export const ForumInsertSchema = z.object(forumShape).partial({
  ...GENERATED,
  workspaceId: true,
  establishment: true,
  seat: true,
  side: true,
  languageProfile: true,
  adapterId: true,
  adapterLevel: true,
  config: true,
  enabled: true,
});

const courtHallShape = {
  id: uuid,
  workspaceId: uuid.nullable(),
  forumId: uuid,
  hallNo: z.string().min(1),
  label: z.string().nullable(),
  ...timestamps,
};
export const CourtHallSelectSchema = z.object(courtHallShape);
export const CourtHallInsertSchema = z
  .object(courtHallShape)
  .partial({ ...GENERATED, workspaceId: true, label: true });

const benchShape = {
  id: uuid,
  workspaceId: uuid.nullable(),
  forumId: uuid,
  judges: z.array(z.string()),
  benchKind: z.enum(BENCH_KINDS),
  ...timestamps,
};
export const BenchSelectSchema = z.object(benchShape);
export const BenchInsertSchema = z
  .object(benchShape)
  .partial({ ...GENERATED, workspaceId: true, judges: true });

// ---------------------------------------------------------------------------------------------
// Matter and documents.

const matterShape = {
  id: uuid,
  workspaceId: uuid,
  title: z.string(),
  practiceArea: z.string().nullable(),
  status: z.enum(MATTER_STATUSES),
  sensitive: z.boolean(),
  ownerMemberId: uuid.nullable(),
  openedAt: z.date(),
  synopsis: z.string().nullable(),
  mergedIntoMatterId: uuid.nullable(),
  ...timestamps,
};
export const MatterSelectSchema = z.object(matterShape);
export const MatterInsertSchema = z
  .object(matterShape)
  .partial({
    ...GENERATED,
    practiceArea: true,
    status: true,
    sensitive: true,
    ownerMemberId: true,
    openedAt: true,
    synopsis: true,
    mergedIntoMatterId: true,
  })
  .superRefine((value, ctx) => {
    if (value.id !== undefined && value.mergedIntoMatterId === value.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['mergedIntoMatterId'],
        message: 'A matter cannot merge into itself',
      });
    }
  });

const documentShape = {
  id: uuid,
  workspaceId: uuid,
  kind: z.enum(DOCUMENT_KINDS),
  language: z.string().nullable(),
  supersedesDocumentId: uuid.nullable(),
  storageKey: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'A lower-case hex SHA-256'),
  textStatus: z.enum(DOCUMENT_TEXT_STATUSES),
  sourceCaptureId: uuid.nullable(),
  matterId: uuid.nullable(),
  // Document pipeline (#45, migration 0058).
  pipelineVersion: z.string().nullable(),
  classificationConfidence: unitInterval.nullable(),
  lowConfidencePages: z.array(z.int().min(1)),
  textSkippedReason: z.string().nullable(),
  textSimhash: z
    .string()
    .regex(/^[0-9a-f]{16}$/, 'A 64-bit simhash as 16 hex characters')
    .nullable(),
  ...timestamps,
};
export const DocumentSelectSchema = z.object(documentShape);
export const DocumentInsertSchema = z
  .object(documentShape)
  .partial({
    ...GENERATED,
    language: true,
    supersedesDocumentId: true,
    textStatus: true,
    sourceCaptureId: true,
    matterId: true,
    pipelineVersion: true,
    classificationConfidence: true,
    lowConfidencePages: true,
    textSkippedReason: true,
    textSimhash: true,
  })
  .superRefine((value, ctx) => {
    if (value.id !== undefined && value.supersedesDocumentId === value.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['supersedesDocumentId'],
        message: 'A document cannot supersede itself',
      });
    }
  });

const documentPageShape = {
  id: uuid,
  workspaceId: uuid,
  documentId: uuid,
  pageNo: z.int().min(1),
  text: z.string().nullable(),
  textSource: z.string().nullable(),
  ocrConfidence: unitInterval.nullable(),
  lang: z.string().nullable(),
  // Page render and search (#45, migration 0058); `searchTsv` is generated by the database.
  imageKey: z.string().nullable(),
  previewKey: z.string().nullable(),
  width: z.int().min(1).nullable(),
  height: z.int().min(1).nullable(),
  // OCR line boxes of an OCR-read page (#52, migration 0060); bbox is [x0, y0, x1, y1], 0..1.
  ocrLines: z
    .array(
      z.object({
        text: z.string(),
        bbox: z.tuple([unitInterval, unitInterval, unitInterval, unitInterval]),
        conf: unitInterval,
      }),
    )
    .nullable(),
  searchTsv: z.string().nullable(),
  ...timestamps,
};
export const DocumentPageSelectSchema = z.object(documentPageShape);
export const DocumentPageInsertSchema = z.object(documentPageShape).partial({
  ...GENERATED,
  text: true,
  textSource: true,
  ocrConfidence: true,
  lang: true,
  imageKey: true,
  previewKey: true,
  width: true,
  height: true,
  ocrLines: true,
  // Generated by the database (to_tsvector of text); never written by the app.
  searchTsv: true,
});

const anchorShape = {
  id: uuid,
  workspaceId: uuid,
  documentId: uuid,
  pageNo: z.int().min(1),
  quote: z.string().max(ANCHOR_QUOTE_MAX),
  charStart: z.int().min(0).nullable(),
  charEnd: z.int().nullable(),
  bbox: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable(),
  kind: z.enum(ANCHOR_KINDS),
  transcriptSpan: z
    .object({ startMs: z.number(), endMs: z.number(), speaker: z.string().exactOptional() })
    .nullable(),
  ...timestamps,
};
export const AnchorSelectSchema = z.object(anchorShape);
export const AnchorInsertSchema = z
  .object(anchorShape)
  .partial({ ...GENERATED, charStart: true, charEnd: true, bbox: true, transcriptSpan: true })
  .superRefine((value, ctx) => {
    if (value.charStart != null && value.charEnd != null && value.charEnd < value.charStart) {
      ctx.addIssue({ code: 'custom', path: ['charEnd'], message: 'charEnd precedes charStart' });
    }
  });

// ---------------------------------------------------------------------------------------------
// Proceedings.

/** Normalised case type: upper-case, no dots or spaces (`WP` for "W.P."). */
const caseTypeCode = z
  .string()
  .refine(
    (value) => value !== '' && value === value.toUpperCase() && !/[.\s]/.test(value),
    'Normalise the case type: upper-case, no dots or spaces',
  );

const proceedingShape = {
  id: uuid,
  workspaceId: uuid,
  matterId: uuid,
  forumId: uuid,
  kind: z.enum(PROCEEDING_KINDS),
  caseTypeCode,
  caseTypeRaw: z.string().nullable(),
  number: nonBlank.nullable(),
  year: z.int().min(1800).max(2200).nullable(),
  srNo: z.string().nullable(),
  frNo: z.string().nullable(),
  diaryNo: z.string().nullable(),
  filingNo: z.string().nullable(),
  cnr: z.string().regex(CNR_PATTERN, '16 upper-case letters and digits').nullable(),
  filingDate: day.nullable(),
  state: z.enum(PROCEEDING_STATES),
  stateChangedAt: z.date(),
  parentProceedingId: uuid.nullable(),
  titlePetitioner: z.string().nullable(),
  titleRespondent: z.string().nullable(),
  ...provenanceShape,
  ...timestamps,
};
export const ProceedingSelectSchema = z.object(proceedingShape);
export const ProceedingInsertSchema = z
  .object(proceedingShape)
  .partial({
    ...GENERATED,
    ...PROVENANCE_OPTIONAL,
    kind: true,
    caseTypeRaw: true,
    number: true,
    year: true,
    srNo: true,
    frNo: true,
    diaryNo: true,
    filingNo: true,
    cnr: true,
    filingDate: true,
    state: true,
    stateChangedAt: true,
    parentProceedingId: true,
    titlePetitioner: true,
    titleRespondent: true,
  })
  .superRefine((value, ctx) => {
    checkProvenance(value, ctx);
    if (
      (value.state === 'numbered' || value.state === 'disposed') &&
      (value.number == null || value.year == null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['number'],
        message: 'A numbered or disposed proceeding needs a number and a year',
      });
    }
    if (value.id !== undefined && value.parentProceedingId === value.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentProceedingId'],
        message: 'A proceeding cannot be its own parent',
      });
    }
  });

const proceedingLinkShape = {
  id: uuid,
  workspaceId: uuid,
  fromProceedingId: uuid,
  toProceedingId: uuid,
  kind: z.enum(PROCEEDING_LINK_KINDS),
  ...provenanceShape,
  ...timestamps,
};
export const ProceedingLinkSelectSchema = z.object(proceedingLinkShape);
export const ProceedingLinkInsertSchema = z
  .object(proceedingLinkShape)
  .partial({ ...GENERATED, ...PROVENANCE_OPTIONAL })
  .superRefine((value, ctx) => {
    checkProvenance(value, ctx);
    if (value.fromProceedingId === value.toProceedingId) {
      ctx.addIssue({
        code: 'custom',
        path: ['toProceedingId'],
        message: 'A proceeding cannot link to itself',
      });
    }
  });

const proceedingStateChangeShape = {
  id: uuid,
  workspaceId: uuid,
  proceedingId: uuid,
  fromState: z.enum(PROCEEDING_STATES),
  toState: z.enum(PROCEEDING_STATES),
  reason: nonBlank.nullable(),
  actorMemberId: uuid.nullable(),
  cureDeadline: day.nullable(),
  changedAt: z.date(),
  ...provenanceShape,
  ...timestamps,
};
export const ProceedingStateChangeSelectSchema = z.object(proceedingStateChangeShape);
export const ProceedingStateChangeInsertSchema = z
  .object(proceedingStateChangeShape)
  .partial({
    ...GENERATED,
    ...PROVENANCE_OPTIONAL,
    reason: true,
    actorMemberId: true,
    cureDeadline: true,
    changedAt: true,
  })
  .superRefine((value, ctx) => {
    checkProvenance(value, ctx);
    if (value.fromState === value.toState) {
      ctx.addIssue({
        code: 'custom',
        path: ['toState'],
        message: 'A transition changes the state',
      });
    }
    if (value.cureDeadline != null && value.toState !== 'defects') {
      ctx.addIssue({
        code: 'custom',
        path: ['cureDeadline'],
        message: 'A cure deadline only applies when entering defects',
      });
    }
    if (value.fromState === 'disposed' && value.toState === 'numbered' && value.reason == null) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reopen needs a reason' });
    }
  });

// ---------------------------------------------------------------------------------------------
// Docket.

const listingShape = {
  id: uuid,
  workspaceId: uuid,
  proceedingId: uuid,
  listDate: day,
  listType: z.enum(LIST_TYPES),
  listNo: z.int().positive().nullable(),
  itemNo: z.string().nullable(),
  stageRaw: z.string(),
  stageNorm: z.string().nullable(),
  hallId: uuid.nullable(),
  benchId: uuid.nullable(),
  canonical: z.boolean(),
  sourceDocumentId: uuid.nullable(),
  ...provenanceShape,
  ...timestamps,
};
export const ListingSelectSchema = z.object(listingShape);
export const ListingInsertSchema = z
  .object(listingShape)
  .partial({
    ...GENERATED,
    ...PROVENANCE_OPTIONAL,
    listNo: true,
    itemNo: true,
    stageNorm: true,
    hallId: true,
    benchId: true,
    canonical: true,
    sourceDocumentId: true,
  })
  .superRefine(checkProvenance);

const hearingShape = {
  id: uuid,
  workspaceId: uuid,
  listingId: uuid,
  heldOn: day,
  outcome: z.string().nullable(),
  adjournmentReason: z.string().nullable(),
  nextDateProposed: day.nullable(),
  nextDateConfirmed: day.nullable(),
  stageAfterRaw: z.string().nullable(),
  ...provenanceShape,
  ...timestamps,
};
export const HearingSelectSchema = z.object(hearingShape);
export const HearingInsertSchema = z
  .object(hearingShape)
  .partial({
    ...GENERATED,
    ...PROVENANCE_OPTIONAL,
    outcome: true,
    adjournmentReason: true,
    nextDateProposed: true,
    nextDateConfirmed: true,
    stageAfterRaw: true,
  })
  .superRefine(checkProvenance);

const appearanceShape = {
  id: uuid,
  workspaceId: uuid,
  hearingId: uuid,
  memberId: uuid.nullable(),
  capacity: z.enum(APPEARANCE_CAPACITIES),
  appearingForPersonId: uuid.nullable(),
  ...timestamps,
};
export const AppearanceSelectSchema = z.object(appearanceShape);
export const AppearanceInsertSchema = z
  .object(appearanceShape)
  .partial({ ...GENERATED, memberId: true, appearingForPersonId: true });

const orderShape = {
  id: uuid,
  workspaceId: uuid,
  proceedingId: uuid,
  documentId: uuid,
  orderDate: day,
  benchId: uuid.nullable(),
  orderType: z.enum(ORDER_TYPES),
  neutralCitation: z.string().nullable(),
  operativeDirections: z.array(z.object({ text: z.string(), anchorId: uuid })),
  nextDate: day.nullable(),
  ...provenanceShape,
  ...timestamps,
};
export const OrderSelectSchema = z.object(orderShape);
export const OrderInsertSchema = z
  .object(orderShape)
  .partial({
    ...GENERATED,
    ...PROVENANCE_OPTIONAL,
    benchId: true,
    neutralCitation: true,
    operativeDirections: true,
    nextDate: true,
  })
  .superRefine(checkProvenance);

const obligationShape = {
  id: uuid,
  workspaceId: uuid,
  matterId: uuid,
  proceedingId: uuid.nullable(),
  source: z.enum(OBLIGATION_SOURCES),
  description: nonBlank,
  dueDate: day.nullable(),
  basis: z.string().nullable(),
  ownerMemberId: uuid.nullable(),
  status: z.enum(OBLIGATION_STATUSES),
  closedReasonType: z.enum(OBLIGATION_CLOSED_REASON_TYPES).nullable(),
  closedBy: uuid.nullable(),
  closedAt: z.date().nullable(),
  closedNote: z.string().nullable(),
  sourceOrderId: uuid.nullable(),
  ...provenanceShape,
  ...timestamps,
};
export const ObligationSelectSchema = z.object(obligationShape);
export const ObligationInsertSchema = z
  .object(obligationShape)
  .partial({
    ...GENERATED,
    ...PROVENANCE_OPTIONAL,
    proceedingId: true,
    dueDate: true,
    basis: true,
    ownerMemberId: true,
    status: true,
    closedReasonType: true,
    closedBy: true,
    closedAt: true,
    closedNote: true,
    sourceOrderId: true,
  })
  .superRefine((value, ctx) => {
    checkProvenance(value, ctx);
    // `obligation_closure_chk` plus the `obligation_closed_by_guard` trigger.
    if (value.status === undefined || value.status === 'open') return;
    for (const key of ['closedReasonType', 'closedBy', 'closedAt'] as const) {
      if (value[key] == null) {
        ctx.addIssue({ code: 'custom', path: [key], message: `A closed obligation needs ${key}` });
      }
    }
    if (value.status === 'not_applicable' && (value.closedNote ?? '').trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['closedNote'],
        message: 'A not-applicable obligation needs a note',
      });
    }
  });

const taskShape = {
  id: uuid,
  workspaceId: uuid,
  matterId: uuid.nullable(),
  proceedingId: uuid.nullable(),
  title: nonBlank,
  dueDate: day.nullable(),
  ownerMemberId: uuid.nullable(),
  status: z.enum(TASK_STATUSES),
  fulfilsObligationId: uuid.nullable(),
  ...provenanceShape,
  ...timestamps,
};
export const TaskSelectSchema = z.object(taskShape);
export const TaskInsertSchema = z
  .object(taskShape)
  .partial({
    ...GENERATED,
    ...PROVENANCE_OPTIONAL,
    matterId: true,
    proceedingId: true,
    dueDate: true,
    ownerMemberId: true,
    status: true,
    fulfilsObligationId: true,
  })
  .superRefine(checkProvenance);

// ---------------------------------------------------------------------------------------------
// People.

const personShape = {
  id: uuid,
  workspaceId: uuid,
  name: nonBlank,
  aliases: z.array(z.string()),
  kind: z.enum(PERSON_KINDS),
  contact: z
    .object({
      email: z.string().exactOptional(),
      phone: z.string().exactOptional(),
      address: z.string().exactOptional(),
    })
    .nullable(),
  ...provenanceShape,
  ...timestamps,
};
export const PersonSelectSchema = z.object(personShape);
export const PersonInsertSchema = z
  .object(personShape)
  .partial({ ...GENERATED, ...PROVENANCE_OPTIONAL, aliases: true, contact: true })
  .superRefine((value, ctx) => {
    checkProvenance(value, ctx);
    // `person_contact_chk` (PRD §9: contact details only for clients and professional contacts).
    if (value.contact != null && value.kind !== 'client' && value.kind !== 'professional') {
      ctx.addIssue({
        code: 'custom',
        path: ['contact'],
        message: 'Only a client or professional contact may have contact details',
      });
    }
  });

const organisationShape = {
  id: uuid,
  workspaceId: uuid,
  name: nonBlank,
  aliases: z.array(z.string()),
  ...timestamps,
};
export const OrganisationSelectSchema = z.object(organisationShape);
export const OrganisationInsertSchema = z
  .object(organisationShape)
  .partial({ ...GENERATED, aliases: true });

const roleEdgeShape = {
  id: uuid,
  workspaceId: uuid,
  kind: z.enum(ROLE_EDGE_KINDS),
  fromPersonId: uuid,
  toPersonId: uuid.nullable(),
  matterId: uuid.nullable(),
  proceedingId: uuid.nullable(),
  ...provenanceShape,
  ...timestamps,
};
export const RoleEdgeSelectSchema = z.object(roleEdgeShape);
export const RoleEdgeInsertSchema = z
  .object(roleEdgeShape)
  .partial({
    ...GENERATED,
    ...PROVENANCE_OPTIONAL,
    toPersonId: true,
    matterId: true,
    proceedingId: true,
  })
  .superRefine((value, ctx) => {
    checkProvenance(value, ctx);
    const targets = [value.toPersonId, value.matterId, value.proceedingId].filter(
      (target) => target != null,
    );
    if (targets.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['toPersonId'],
        message: 'A role edge has exactly one target: a person, a matter or a proceeding',
      });
    }
    if (value.toPersonId != null && value.toPersonId === value.fromPersonId) {
      ctx.addIssue({
        code: 'custom',
        path: ['toPersonId'],
        message: 'A person cannot have a role edge to themselves',
      });
    }
  });

// ---------------------------------------------------------------------------------------------
// Types.

export type Forum = z.output<typeof ForumSelectSchema>;
export type NewForum = z.input<typeof ForumInsertSchema>;
export type CourtHall = z.output<typeof CourtHallSelectSchema>;
export type NewCourtHall = z.input<typeof CourtHallInsertSchema>;
export type Bench = z.output<typeof BenchSelectSchema>;
export type NewBench = z.input<typeof BenchInsertSchema>;
export type Matter = z.output<typeof MatterSelectSchema>;
export type NewMatter = z.input<typeof MatterInsertSchema>;
export type Document = z.output<typeof DocumentSelectSchema>;
export type NewDocument = z.input<typeof DocumentInsertSchema>;
export type DocumentPage = z.output<typeof DocumentPageSelectSchema>;
export type NewDocumentPage = z.input<typeof DocumentPageInsertSchema>;
export type Anchor = z.output<typeof AnchorSelectSchema>;
export type NewAnchor = z.input<typeof AnchorInsertSchema>;
export type Proceeding = z.output<typeof ProceedingSelectSchema>;
export type NewProceeding = z.input<typeof ProceedingInsertSchema>;
export type ProceedingLink = z.output<typeof ProceedingLinkSelectSchema>;
export type NewProceedingLink = z.input<typeof ProceedingLinkInsertSchema>;
export type ProceedingStateChange = z.output<typeof ProceedingStateChangeSelectSchema>;
export type NewProceedingStateChange = z.input<typeof ProceedingStateChangeInsertSchema>;
export type Listing = z.output<typeof ListingSelectSchema>;
export type NewListing = z.input<typeof ListingInsertSchema>;
export type Hearing = z.output<typeof HearingSelectSchema>;
export type NewHearing = z.input<typeof HearingInsertSchema>;
export type Appearance = z.output<typeof AppearanceSelectSchema>;
export type NewAppearance = z.input<typeof AppearanceInsertSchema>;
export type Order = z.output<typeof OrderSelectSchema>;
export type NewOrder = z.input<typeof OrderInsertSchema>;
export type Obligation = z.output<typeof ObligationSelectSchema>;
export type NewObligation = z.input<typeof ObligationInsertSchema>;
export type Task = z.output<typeof TaskSelectSchema>;
export type NewTask = z.input<typeof TaskInsertSchema>;
export type Person = z.output<typeof PersonSelectSchema>;
export type NewPerson = z.input<typeof PersonInsertSchema>;
export type Organisation = z.output<typeof OrganisationSelectSchema>;
export type NewOrganisation = z.input<typeof OrganisationInsertSchema>;
export type RoleEdge = z.output<typeof RoleEdgeSelectSchema>;
export type NewRoleEdge = z.input<typeof RoleEdgeInsertSchema>;
