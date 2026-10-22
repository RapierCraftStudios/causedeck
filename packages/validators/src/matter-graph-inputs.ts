// Matter-graph service inputs (#362, part 1 of #33): the zod inputs of the `@causedeck/core`
// matter-graph services (matters, proceedings, documents, the duplicate finder; merges and splits,
// #365). The services parse every input with these before touching the database. Later #33 parts
// (#363-#366) append their own inputs here. Objects are strict: an unknown key is an error, not
// silently dropped. An undo takes back the `UndoPayload` its operation returned (stored by #47), and
// parses it here too: a stored payload is input like any other.
//
// Case types, numbers and two-digit years arrive as printed; the services normalise them
// (`normaliseCaseType`), so these schemas only reject what can never be valid.
import { z } from 'zod';

import {
  CNR_PATTERN,
  DOCUMENT_KINDS,
  LIST_TYPES,
  MATTER_STATUSES,
  PERSON_KINDS,
  PROCEEDING_KINDS,
  PROCEEDING_LINK_KINDS,
  PROCEEDING_STATES,
  ProvenanceSchema,
  ROLE_EDGE_KINDS,
} from './matter-graph';

const uuid = z.uuid();
const day = z.iso.date();
const text = z.string().trim().min(1, 'Must not be blank');
/** A year as printed: two digits (expanded by the service) or four within 1800..2200. */
const year = z
  .int()
  .refine((value) => (value >= 0 && value <= 99) || (value >= 1800 && value <= 2200), {
    message: 'A two-digit year or a year within 1800..2200',
  });
/** A CNR as typed: upper-cased and trimmed before the format check. */
const cnr = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(CNR_PATTERN, '16 letters and digits'));

/** The page size of a keyset list. */
const limit = z.int().min(1).max(100).default(50);

/** At least one key of the patch must be present. */
function nonEmpty(value: Record<string, unknown>): boolean {
  return Object.values(value).some((v) => v !== undefined);
}

// ---------------------------------------------------------------------------------------------
// Matters.

export const CreateMatterInput = z.strictObject({
  title: text,
  practiceArea: text.nullable().optional(),
  sensitive: z.boolean().optional(),
  ownerMemberId: uuid.nullable().optional(),
  synopsis: z.string().nullable().optional(),
});

export const UpdateMatterInput = z.strictObject({
  matterId: uuid,
  patch: z
    .strictObject({
      title: text.optional(),
      practiceArea: text.nullable().optional(),
      sensitive: z.boolean().optional(),
      ownerMemberId: uuid.nullable().optional(),
      synopsis: z.string().nullable().optional(),
    })
    .refine(nonEmpty, 'Change at least one field'),
});

export const ArchiveMatterInput = z.strictObject({ matterId: uuid });

export const ListMattersInput = z.strictObject({
  status: z.enum(MATTER_STATUSES).optional(),
  limit,
  cursor: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------------------------
// Proceedings.

const identifiers = {
  number: text.nullable().optional(),
  year: year.nullable().optional(),
  cnr: cnr.nullable().optional(),
  srNo: text.nullable().optional(),
  frNo: text.nullable().optional(),
  diaryNo: text.nullable().optional(),
  filingNo: text.nullable().optional(),
};

export const CreateProceedingInput = z.strictObject({
  matterId: uuid,
  forumId: uuid,
  kind: z.enum(PROCEEDING_KINDS).optional(),
  /** As printed, e.g. `W.P.`; stored normalised as `case_type_code`. */
  caseType: text,
  ...identifiers,
  filingDate: day.nullable().optional(),
  parentProceedingId: uuid.nullable().optional(),
  titlePetitioner: z.string().nullable().optional(),
  titleRespondent: z.string().nullable().optional(),
  provenance: ProvenanceSchema,
});

export const UpdateIdentifiersInput = z
  .strictObject({
    proceedingId: uuid,
    caseType: text.optional(),
    ...identifiers,
  })
  .refine(
    (value) => nonEmpty({ ...value, proceedingId: undefined }),
    'Change at least one identifier',
  );

export const LinkProceedingsInput = z
  .strictObject({
    fromProceedingId: uuid,
    toProceedingId: uuid,
    kind: z.enum(PROCEEDING_LINK_KINDS),
    provenance: ProvenanceSchema,
  })
  .refine((value) => value.fromProceedingId !== value.toProceedingId, {
    path: ['toProceedingId'],
    message: 'A proceeding cannot link to itself',
  });

/** What identifies a proceeding for the duplicate finder: a CNR, or case type x number x year. */
export const ProceedingIdentityInput = z
  .strictObject({
    forumId: uuid.optional(),
    caseType: text.optional(),
    number: text.optional(),
    year: year.optional(),
    cnr: cnr.optional(),
  })
  .refine(
    (value) =>
      value.cnr !== undefined ||
      (value.caseType !== undefined && value.number !== undefined && value.year !== undefined),
    'Give a CNR or a case type, number and year',
  );

export const FindDuplicateProceedingsInput = z.strictObject({
  identity: ProceedingIdentityInput,
  excludeProceedingId: uuid.optional(),
  limit: z.int().min(1).max(50).default(10),
});

// ---------------------------------------------------------------------------------------------
// Proceeding state machine (#363, ADR 0016).

/**
 * A state change is always made by a resolved member, its confirming actor, so its provenance is
 * never `proposed` (proposals are #47's); the service records `confirmed` when none is given.
 */
const transitionProvenance = ProvenanceSchema.refine(
  (value) => value.confirmationState !== 'proposed',
  {
    path: ['confirmationState'],
    message: 'A state change is confirmed by its actor; it cannot be proposed',
  },
);

/**
 * Move a proceeding to `to`. Numbering takes `number` and `year` in the same call; entering
 * `defects` may carry the registry's `cureDeadline`. Which pairs are allowed is the state
 * machine's call (`InvalidTransitionError`), not the input's.
 */
export const TransitionProceedingInput = z
  .strictObject({
    proceedingId: uuid,
    to: z.enum(PROCEEDING_STATES),
    reason: text.optional(),
    number: text.optional(),
    year: year.optional(),
    cureDeadline: day.optional(),
    provenance: transitionProvenance.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.to === 'numbered') {
      for (const key of ['number', 'year'] as const) {
        if (value[key] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Numbering needs a number and a year',
          });
        }
      }
    } else {
      for (const key of ['number', 'year'] as const) {
        if (value[key] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'A number and year are only given when numbering',
          });
        }
      }
    }
    if (value.cureDeadline !== undefined && value.to !== 'defects') {
      ctx.addIssue({
        code: 'custom',
        path: ['cureDeadline'],
        message: 'A cure deadline only applies when entering defects',
      });
    }
  });

// ---------------------------------------------------------------------------------------------
// Documents.

export const CreateDocumentInput = z.strictObject({
  matterId: uuid,
  kind: z.enum(DOCUMENT_KINDS),
  storageKey: text,
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'A lower-case hex SHA-256'),
  language: text.nullable().optional(),
  supersedesDocumentId: uuid.nullable().optional(),
});

// ---------------------------------------------------------------------------------------------
// Merges and splits (#365).

export const MergeMattersInput = z
  .strictObject({ intoMatterId: uuid, fromMatterId: uuid })
  .refine((value) => value.intoMatterId !== value.fromMatterId, {
    path: ['fromMatterId'],
    message: 'A matter cannot be merged into itself',
  });

export const SplitMatterInput = z.strictObject({
  matterId: uuid,
  proceedingIds: z
    .array(uuid)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
      message: 'Proceedings must not repeat',
    }),
  newTitle: text,
});

/** What a split would move (#392): the split's proceedings, before a new title is chosen. */
export const PreviewSplitMatterInput = SplitMatterInput.omit({ newTitle: true });

export const MergeProceedingsInput = z
  .strictObject({ intoProceedingId: uuid, fromProceedingId: uuid })
  .refine((value) => value.intoProceedingId !== value.fromProceedingId, {
    path: ['fromProceedingId'],
    message: 'A proceeding cannot be merged into itself',
  });

/** `timestamptz::text` (or ISO), microseconds kept, so an undo restores the exact value. */
const instant = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?|Z)$/,
    'A timestamp',
  );
const MAX_ROWS = 10_000;
/** A row an operation changed, with its `updated_at` before the change. */
const stamp = z.strictObject({ id: uuid, updatedAt: instant });
const stamps = z.array(stamp).max(MAX_ROWS);
/** A row whose `matter_id` may have changed with its proceeding (obligation, task). */
const matterStamps = z
  .array(z.strictObject({ id: uuid, updatedAt: instant, matterId: uuid.nullable() }))
  .max(MAX_ROWS);
/** A whole row as `to_jsonb(row)`, re-inserted by the undo. */
const wholeRow = z.looseObject({ id: uuid });

/** Which proceeding (and source) an identifier of a merged proceeding came from. */
export const IdentifierSourceSchema = z.strictObject({
  proceedingId: uuid,
  sourceType: z.string().min(1),
  sourceRef: z.string().nullable(),
});

export const MatterMergeUndoPayload = z.strictObject({
  op: z.literal('matter.merge'),
  version: z.literal(1),
  before: z.strictObject({
    intoMatterId: uuid,
    fromMatterId: uuid,
    fromMatter: z.strictObject({ mergedIntoMatterId: uuid.nullable(), updatedAt: instant }),
    rows: z.strictObject({
      proceeding: stamps,
      document: stamps,
      roleEdge: stamps,
      obligation: stamps,
      task: stamps,
      mergedMatter: stamps,
    }),
    links: z.array(uuid).max(MAX_ROWS),
  }),
  after: z.strictObject({ intoMatterId: uuid }),
});

export const MatterSplitUndoPayload = z.strictObject({
  op: z.literal('matter.split'),
  version: z.literal(1),
  before: z.strictObject({
    matterId: uuid,
    rows: z.strictObject({ proceeding: stamps, obligation: stamps, task: stamps }),
  }),
  after: z.strictObject({ newMatterId: uuid }),
});

export const ProceedingMergeUndoPayload = z.strictObject({
  op: z.literal('proceeding.merge'),
  version: z.literal(1),
  before: z.strictObject({
    intoProceedingId: uuid,
    fromProceedingId: uuid,
    into: wholeRow,
    from: wholeRow,
    rows: z.strictObject({
      listing: stamps,
      order: stamps,
      obligation: matterStamps,
      task: matterStamps,
      roleEdge: stamps,
      // proceeding_state_change (#363): the source's state history follows the survivor.
      stateChange: stamps,
      child: stamps,
      link: z
        .array(
          z.strictObject({
            id: uuid,
            updatedAt: instant,
            fromProceedingId: uuid,
            toProceedingId: uuid,
          }),
        )
        .max(MAX_ROWS),
    }),
    demotedListing: stamp.nullable(),
    deletedLinks: z.array(wholeRow).max(MAX_ROWS),
  }),
  after: z.strictObject({
    intoProceedingId: uuid,
    identifierSources: z.record(z.string(), IdentifierSourceSchema),
  }),
});

export const UndoMergeInput = z.strictObject({ payload: MatterMergeUndoPayload });
export const UndoSplitInput = z.strictObject({ payload: MatterSplitUndoPayload });
export const UndoMergeProceedingsInput = z.strictObject({ payload: ProceedingMergeUndoPayload });

// ---------------------------------------------------------------------------------------------
// Next date (#364, part 3 of #33). A proposal is always stored as `proposed`: only
// `confirmNextDate` confirms a date, so a proposal claiming another confirmation state is invalid.

export const ProposeNextDateInput = z.strictObject({
  proceedingId: uuid,
  date: day,
  provenance: ProvenanceSchema.refine(
    (value) => value.confirmationState === undefined || value.confirmationState === 'proposed',
    { path: ['confirmationState'], message: 'A proposed next date is always proposed' },
  ),
  listType: z.enum(LIST_TYPES).default('daily'),
  /** The stage heading as printed; empty when the source does not print one. */
  stageRaw: z.string().trim().default(''),
  listNo: z.int().positive().nullable().optional(),
  itemNo: text.nullable().optional(),
});

export const ConfirmNextDateInput = z.strictObject({
  listingId: uuid,
  /** A date before today (Asia/Kolkata) is refused unless this is set explicitly. */
  allowPast: z.boolean().default(false),
});

export const GetCanonicalNextDateInput = z.strictObject({ proceedingId: uuid });

/** How a person resolves a next-date conflict card (#390): keep A, take B, or type a date. */
export const NEXT_DATE_CHOICES = ['current', 'proposed', 'manual'] as const;

/**
 * Resolve one conflict: the proceeding's canonical listing (`current`) against a differing
 * proposal (`proposed`). `date` is the typed date, required for `manual` and refused otherwise.
 */
export const ChooseNextDateSourceInput = z
  .strictObject({
    currentListingId: uuid,
    proposedListingId: uuid,
    choice: z.enum(NEXT_DATE_CHOICES),
    date: day.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.choice === 'manual' && value.date === undefined) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'Enter the next date' });
    }
    if (value.choice !== 'manual' && value.date !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['date'],
        message: 'Only a manual choice takes a date',
      });
    }
  });

// ---------------------------------------------------------------------------------------------
// Timeline (#366, part 5 of #33). `from` and `to` are inclusive court days (Asia/Kolkata);
// `bench_change` is reserved for #39 and matches nothing yet.

export const TIMELINE_EVENT_KINDS = [
  'listing',
  'hearing',
  'order',
  'obligation_due',
  'obligation_closed',
  'state_change',
  'document_added',
  'bench_change',
] as const;
export type TimelineEventKind = (typeof TIMELINE_EVENT_KINDS)[number];

export const GetMatterTimelineInput = z
  .strictObject({
    matterId: uuid,
    from: day.optional(),
    to: day.optional(),
    kinds: z.array(z.enum(TIMELINE_EVENT_KINDS)).min(1, 'At least one kind').optional(),
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    path: ['to'],
    message: 'to must not be before from',
  });

// ---------------------------------------------------------------------------------------------
// Matter read models, people and the sensitive flag (#386, part 1 of #40). `searchMatters` sorts
// by the canonical next date (nulls last), the last update or the title; its cursor is opaque and
// tied to the sort it came from. A person keeps contact details only as a client or professional
// contact (PRD §9, `person_contact_chk`); a role edge names exactly one target.

export const MATTER_SORTS = ['next_date', 'updated', 'title'] as const;
export type MatterSort = (typeof MATTER_SORTS)[number];

export const SearchMattersInput = z.strictObject({
  status: z.enum(MATTER_STATUSES).optional(),
  /** Matters with any proceeding before this forum. */
  forumId: uuid.optional(),
  ownerMemberId: uuid.optional(),
  /** `true`: only matters without an upcoming canonical next date. */
  noNextDate: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  /** A title, a party or a case number in any punctuation (`W.P. No. 45 of 2026`, `wp 45/26`). */
  q: z.string().trim().min(1, 'Must not be blank').max(200).optional(),
  sort: z.enum(MATTER_SORTS).default('next_date'),
  limit,
  cursor: z.string().min(1).optional(),
});

/** A read model of one matter. */
export const MatterReadInput = z.strictObject({ matterId: uuid });

export const ListMatterDocumentsInput = z.strictObject({
  matterId: uuid,
  limit,
  cursor: z.string().min(1).optional(),
});

/** Contact kinds: the only person kinds that may carry contact details. */
export const CONTACT_PERSON_KINDS = ['client', 'professional'] as const;

const PersonContactInput = z
  .strictObject({
    email: z.email().max(320).exactOptional(),
    phone: text.max(40).exactOptional(),
    address: text.max(500).exactOptional(),
  })
  .refine(nonEmpty, 'Give at least one contact detail');

export const UpsertPersonInput = z
  .strictObject({
    /** Absent: a new person. Present: the person of the workspace to update. */
    personId: uuid.optional(),
    name: text.max(300),
    /** Replaces the stored aliases when given; a new person defaults to none. */
    aliases: z.array(text.max(300)).max(20).optional(),
    kind: z.enum(PERSON_KINDS),
    /** `undefined` keeps the stored contact, `null` clears it. */
    contact: PersonContactInput.nullable().optional(),
    provenance: ProvenanceSchema.optional(),
  })
  .refine(
    (value) =>
      value.contact == null || (CONTACT_PERSON_KINDS as readonly string[]).includes(value.kind),
    { path: ['contact'], message: 'Contact details are kept only for clients and professionals' },
  );

export const SetRoleEdgeInput = z
  .strictObject({
    kind: z.enum(ROLE_EDGE_KINDS),
    fromPersonId: uuid,
    toPersonId: uuid.optional(),
    matterId: uuid.optional(),
    proceedingId: uuid.optional(),
    /** Delete the edge instead of setting it. */
    remove: z.boolean().default(false),
    provenance: ProvenanceSchema.optional(),
  })
  .refine(
    (value) =>
      [value.toPersonId, value.matterId, value.proceedingId].filter((v) => v !== undefined)
        .length === 1,
    { path: ['matterId'], message: 'Name exactly one of toPersonId, matterId or proceedingId' },
  )
  .refine((value) => value.toPersonId === undefined || value.toPersonId !== value.fromPersonId, {
    path: ['toPersonId'],
    message: 'A person cannot have a role towards themselves',
  });

export const SetSensitiveInput = z.strictObject({ matterId: uuid, sensitive: z.boolean() });

// ---------------------------------------------------------------------------------------------
// Types: `…Input` is what a caller passes, `Parsed…` what a service works with.

export type CreateMatterInput = z.input<typeof CreateMatterInput>;
export type ParsedCreateMatter = z.output<typeof CreateMatterInput>;
export type UpdateMatterInput = z.input<typeof UpdateMatterInput>;
export type ParsedUpdateMatter = z.output<typeof UpdateMatterInput>;
export type ArchiveMatterInput = z.input<typeof ArchiveMatterInput>;
export type ListMattersInput = z.input<typeof ListMattersInput>;
export type ParsedListMatters = z.output<typeof ListMattersInput>;
export type CreateProceedingInput = z.input<typeof CreateProceedingInput>;
export type ParsedCreateProceeding = z.output<typeof CreateProceedingInput>;
export type UpdateIdentifiersInput = z.input<typeof UpdateIdentifiersInput>;
export type ParsedUpdateIdentifiers = z.output<typeof UpdateIdentifiersInput>;
export type LinkProceedingsInput = z.input<typeof LinkProceedingsInput>;
export type ParsedLinkProceedings = z.output<typeof LinkProceedingsInput>;
export type ProceedingIdentityInput = z.input<typeof ProceedingIdentityInput>;
export type FindDuplicateProceedingsInput = z.input<typeof FindDuplicateProceedingsInput>;
export type ParsedFindDuplicateProceedings = z.output<typeof FindDuplicateProceedingsInput>;
export type TransitionProceedingInput = z.input<typeof TransitionProceedingInput>;
export type ParsedTransitionProceeding = z.output<typeof TransitionProceedingInput>;
export type CreateDocumentInput = z.input<typeof CreateDocumentInput>;
export type ParsedCreateDocument = z.output<typeof CreateDocumentInput>;
export type MergeMattersInput = z.input<typeof MergeMattersInput>;
export type SplitMatterInput = z.input<typeof SplitMatterInput>;
export type PreviewSplitMatterInput = z.input<typeof PreviewSplitMatterInput>;
export type MergeProceedingsInput = z.input<typeof MergeProceedingsInput>;
export type IdentifierSource = z.output<typeof IdentifierSourceSchema>;
export type MatterMergeUndoPayload = z.output<typeof MatterMergeUndoPayload>;
export type MatterSplitUndoPayload = z.output<typeof MatterSplitUndoPayload>;
export type ProceedingMergeUndoPayload = z.output<typeof ProceedingMergeUndoPayload>;
export type UndoMergeInput = z.input<typeof UndoMergeInput>;
export type UndoSplitInput = z.input<typeof UndoSplitInput>;
export type UndoMergeProceedingsInput = z.input<typeof UndoMergeProceedingsInput>;
export type ProposeNextDateInput = z.input<typeof ProposeNextDateInput>;
export type ParsedProposeNextDate = z.output<typeof ProposeNextDateInput>;
export type ConfirmNextDateInput = z.input<typeof ConfirmNextDateInput>;
export type ParsedConfirmNextDate = z.output<typeof ConfirmNextDateInput>;
export type GetCanonicalNextDateInput = z.input<typeof GetCanonicalNextDateInput>;
export type NextDateChoice = (typeof NEXT_DATE_CHOICES)[number];
export type ChooseNextDateSourceInput = z.input<typeof ChooseNextDateSourceInput>;
export type ParsedChooseNextDateSource = z.output<typeof ChooseNextDateSourceInput>;
export type GetMatterTimelineInput = z.input<typeof GetMatterTimelineInput>;
export type ParsedGetMatterTimeline = z.output<typeof GetMatterTimelineInput>;
export type SearchMattersInput = z.input<typeof SearchMattersInput>;
export type ParsedSearchMatters = z.output<typeof SearchMattersInput>;
export type MatterReadInput = z.input<typeof MatterReadInput>;
export type ListMatterDocumentsInput = z.input<typeof ListMatterDocumentsInput>;
export type UpsertPersonInput = z.input<typeof UpsertPersonInput>;
export type ParsedUpsertPerson = z.output<typeof UpsertPersonInput>;
export type SetRoleEdgeInput = z.input<typeof SetRoleEdgeInput>;
export type ParsedSetRoleEdge = z.output<typeof SetRoleEdgeInput>;
export type SetSensitiveInput = z.input<typeof SetSensitiveInput>;
