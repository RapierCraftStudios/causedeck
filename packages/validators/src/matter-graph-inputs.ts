// Matter-graph service inputs (#362, part 1 of #33): the zod inputs of the `@causedeck/core`
// matter-graph services (matters, proceedings, documents, the duplicate finder). The services parse
// every input with these before touching the database. Later #33 parts (#363-#366) append their own
// inputs here. Objects are strict: an unknown key is an error, not silently dropped.
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
