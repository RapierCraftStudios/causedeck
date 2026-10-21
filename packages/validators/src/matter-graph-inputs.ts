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
  MATTER_STATUSES,
  PROCEEDING_KINDS,
  PROCEEDING_LINK_KINDS,
  ProvenanceSchema,
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
export type CreateDocumentInput = z.input<typeof CreateDocumentInput>;
export type ParsedCreateDocument = z.output<typeof CreateDocumentInput>;
export type MergeMattersInput = z.input<typeof MergeMattersInput>;
export type SplitMatterInput = z.input<typeof SplitMatterInput>;
export type MergeProceedingsInput = z.input<typeof MergeProceedingsInput>;
export type IdentifierSource = z.output<typeof IdentifierSourceSchema>;
export type MatterMergeUndoPayload = z.output<typeof MatterMergeUndoPayload>;
export type MatterSplitUndoPayload = z.output<typeof MatterSplitUndoPayload>;
export type ProceedingMergeUndoPayload = z.output<typeof ProceedingMergeUndoPayload>;
export type UndoMergeInput = z.input<typeof UndoMergeInput>;
export type UndoSplitInput = z.input<typeof UndoSplitInput>;
export type UndoMergeProceedingsInput = z.input<typeof UndoMergeProceedingsInput>;
