// Court-adapter contract (#369, part 1 of #35; docs/product/10 §5.1, ADR 0015). Every input and
// output is a zod schema with an inferred type, so adapters, the golden harness and callers share
// one checked shape. Access modes are the frozen registry list (ADR 0011): `official`, never
// `official_feed`. Parsers only read what the lawyer supplied; nothing here fetches.
import { ACCESS_MODES } from '@causedeck/flags/access-mode';
import { z } from 'zod';

import type { AdapterConfig } from './config/schema.ts';

export const AccessModeSchema = z.enum(ACCESS_MODES);
export type AccessMode = z.infer<typeof AccessModeSchema>;

/** The adapter resources an access mode is declared for. */
export const RESOURCES = ['cause_list', 'orders', 'status', 'display_board'] as const;
export const ResourceSchema = z.enum(RESOURCES);
export type Resource = z.infer<typeof ResourceSchema>;

/** One declared mode per resource; `none` means the adapter never uses it. */
export const AccessModesSchema = z.object({
  cause_list: AccessModeSchema,
  orders: AccessModeSchema,
  status: AccessModeSchema,
  display_board: AccessModeSchema,
});
export type AccessModes = z.infer<typeof AccessModesSchema>;

/** A rectangle on a page in PDF points, origin top-left. */
export const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type BBox = z.infer<typeof BBoxSchema>;

/**
 * A positioned reading of a document, produced by `layoutFromPdf`, `layoutFromHtml` and
 * `layoutFromText` (#370). `text` is the page's reading-order text that anchors quote from; `items`
 * are its lines and `words` the whitespace-split words, each with a bbox. `textCoverage` is the
 * share of the page covered by text-layer text: 0 means there is none, so the caller OCRs the page
 * (#45). HTML and text pages have no coordinates (width and height 0, no items).
 */
export const LayoutDocumentSchema = z.object({
  pages: z.array(
    z.object({
      page: z.number().int().min(1),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
      text: z.string(),
      items: z.array(z.object({ text: z.string(), bbox: BBoxSchema })),
      words: z.array(z.object({ text: z.string().min(1), bbox: BBoxSchema })).optional(),
      textCoverage: z.number().min(0).max(1).optional(),
    }),
  ),
});
export type LayoutDocument = z.infer<typeof LayoutDocumentSchema>;

export const ParserInputSchema = z.object({
  kind: z.enum(['layout', 'html', 'text', 'email']),
  layout: LayoutDocumentSchema.optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  meta: z.object({
    fileName: z.string().optional(),
    /** ISO timestamp of when the lawyer supplied the document. */
    receivedAt: z.string().min(1),
    forumCode: z.string().min(1),
    language: z.string().optional(),
  }),
});
export type ParserInput = z.infer<typeof ParserInputSchema>;

/** Where a parsed value comes from: the page, the verbatim quote and the row it belongs to. */
export const AnchorSchema = z.object({
  page: z.number().int().min(1),
  quote: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  bbox: BBoxSchema.optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const ConfidenceSchema = z.number().min(0).max(1);

/** The match-key fields of one case reference; `children` are the references filed in it. */
export interface CaseRef {
  /** Normal form (`compactCaseType`) of the printed type; unknown types keep theirs. */
  caseTypeCode: string | null;
  caseTypeRaw: string;
  number: string;
  year: number;
  seatSuffix?: string | undefined;
  /** A miscellaneous petition (WMP, CRL MP, ...) filed within a main case. */
  isMisc?: boolean | undefined;
  matchKey: string | null;
  /** The parent's match key when this reference is filed within another on the same line. */
  parentProceedingKey?: string | null | undefined;
  children?: CaseRef[] | undefined;
}

/**
 * A case reference as printed on a list line or an order header (#36): `CRL OP No.4567 of 2026 and
 * Crl.M.P.Nos.1 & 2 of 2026` is one main reference with two children.
 */
export const CaseRefSchema: z.ZodType<CaseRef> = z.lazy(() =>
  z.object({
    caseTypeCode: z.string().nullable(),
    caseTypeRaw: z.string(),
    number: z.string().min(1),
    year: z.number().int(),
    seatSuffix: z.string().optional(),
    isMisc: z.boolean().optional(),
    matchKey: z.string().nullable(),
    parentProceedingKey: z.string().nullable().optional(),
    children: z.array(CaseRefSchema).optional(),
  }),
);

/** An advocate named on a row: the raw text, normalised aliases and the enrolment number if any. */
export const AdvocateSchema = z.object({
  raw: z.string().min(1),
  /** Upper-case, title-stripped spellings; never transliterated. */
  aliases: z.array(z.string().min(1)),
  /** Bar enrolment number, e.g. `MS/123/1900`: the stable matching key when present. */
  enrolmentNo: z.string().min(1).optional(),
});
export type Advocate = z.infer<typeof AdvocateSchema>;

/**
 * One cause-list row. It is never emitted without an anchor. Rows are returned to the caller, which
 * keeps the ones matching a matter and discards the rest (docs/product/09 §8.4); nothing persists.
 */
export const ParsedListRowSchema = z.object({
  anchor: AnchorSchema,
  confidence: ConfidenceSchema,
  hallNo: z.string().optional(),
  itemNo: z.string().optional(),
  caseTypeRaw: z.string(),
  caseType: z.string().nullable(),
  seatSuffix: z.string().optional(),
  caseNumber: z.string().nullable(),
  caseYear: z.number().int().nullable(),
  matchKey: z.string().nullable(),
  parties: z.string().optional(),
  /** The heading this row sits under, verbatim. */
  stageRaw: z.string().nullable(),
  /** The `stageMap` key for `stageRaw`, or null when no pattern matched (open enum). */
  stageNorm: z.string().nullable(),
  // #36 additions, all optional so earlier adapters and fixtures stay valid.
  advocates: z.array(AdvocateSchema).optional(),
  /** References filed within this row's main case (miscellaneous petitions, `X in Y`). */
  children: z.array(CaseRefSchema).optional(),
  /** The main case's match key when this row is itself a child reference. */
  parentProceedingKey: z.string().nullable().optional(),
  bench: z.string().optional(),
  /** The row names a seat other than the parsed forum's (e.g. `(MD)` on a Principal Seat list). */
  forumMismatch: z.boolean().optional(),
});
export type ParsedListRow = z.infer<typeof ParsedListRowSchema>;

export const ParseDiagnosticsSchema = z.object({
  /** Headings no `stageMap` pattern matched, verbatim, in order of first appearance. */
  unmappedHeadings: z.array(z.string()),
  unknownCaseTypes: z.array(z.string()),
  /** Candidate rows dropped because their quote could not be anchored in the page text. */
  rowsSkippedNoAnchor: z.number().int().nonnegative(),
  hallsSeen: z.array(z.string()),
  hallsUnreadable: z.array(z.string()),
});
export type ParseDiagnostics = z.infer<typeof ParseDiagnosticsSchema>;

/** A row whose case number could not be parsed: returned with its anchor, never dropped. */
export const UnparsedRowSchema = z.object({
  anchor: AnchorSchema,
  text: z.string().min(1),
  reason: z.string().min(1),
});
export type UnparsedRow = z.infer<typeof UnparsedRowSchema>;

export const CauseListHallSchema = z.object({
  hallNo: z.string().min(1),
  bench: z.string().optional(),
  lists: z.array(z.object({ listNo: z.string().optional(), rows: z.array(ParsedListRowSchema) })),
});
export type CauseListHall = z.infer<typeof CauseListHallSchema>;

/** An attachment of a supplied email: its MIME part path (`2`, `1.2`), never its bytes. */
export const ListAttachmentSchema = z.object({
  ref: z.string().min(1),
  fileName: z.string().optional(),
  contentType: z.string().min(1),
});
export type ListAttachment = z.infer<typeof ListAttachmentSchema>;

export const PARSE_STATUSES = ['ok', 'empty', 'failed'] as const;
export const LIST_SOURCES = ['pdf', 'html', 'email', 'text'] as const;

export const ParsedCauseListSchema = z.object({
  adapterId: z.string().min(1),
  adapterVersion: z.string().min(1),
  forumCode: z.string().min(1),
  /** ISO date of the list, when the document states one. */
  listDate: z.string().nullable(),
  rows: z.array(ParsedListRowSchema),
  diagnostics: ParseDiagnosticsSchema,
  // #36 additions, all optional.
  halls: z.array(CauseListHallSchema).optional(),
  unparsedRows: z.array(UnparsedRowSchema).optional(),
  /** `empty` is a list with no cases; `failed` a document that could not be read. */
  status: z.enum(PARSE_STATUSES).optional(),
  /** Daily, advance, supplementary, special: the printed marker's key, or null. */
  listType: z.string().nullable().optional(),
  source: z.enum(LIST_SOURCES).optional(),
  /** The phrase `listDate` was read from (#396). */
  listDateAnchor: AnchorSchema.nullable().optional(),
  /** Attachments the list may sit in (a PDF-only AIMS email, #396), for the caller's PDF path. */
  attachments: z.array(ListAttachmentSchema).optional(),
});
export type ParsedCauseList = z.infer<typeof ParsedCauseListSchema>;

export const ParsedOrderHeaderSchema = z.object({
  caseTypeRaw: z.string().nullable(),
  caseType: z.string().nullable(),
  seatSuffix: z.string().optional(),
  caseNumber: z.string().nullable(),
  caseYear: z.number().int().nullable(),
  orderDate: z.string().nullable(),
  neutralCitation: z.string().nullable(),
  anchor: AnchorSchema.nullable(),
  confidence: ConfidenceSchema,
  // #36 additions, all optional.
  /** Every case the order is passed in (a common order names many). */
  caseRefs: z.array(CaseRefSchema).optional(),
  bench: z.string().nullable().optional(),
  /** The judges on the bench, verbatim, in printed order (#398). */
  judges: z.array(z.string().min(1)).optional(),
  /** The neutral citation as printed, with its separator (`2026/MHC/123`); `neutralCitation` is canonical. */
  neutralCitationRaw: z.string().nullable().optional(),
  orderType: z.enum(['daily', 'interim', 'final', 'judgment']).nullable().optional(),
});
export type ParsedOrderHeader = z.infer<typeof ParsedOrderHeaderSchema>;

/** A sentence in an order that reads like a direction ("list after two weeks"), anchored. */
export const DirectionCueSchema = z.object({
  kind: z.string().min(1),
  text: z.string().min(1),
  anchor: AnchorSchema,
  confidence: ConfidenceSchema,
  /** The matched phrase, verbatim (`list after`, `post on`). */
  phrase: z.string().min(1).optional(),
  /** ISO date, only when the literal date is printed in the cue; relative cues stay unresolved. */
  date: z.string().nullable().optional(),
});
export type DirectionCue = z.infer<typeof DirectionCueSchema>;

export const REGISTRY_EVENT_KINDS = [
  'sr_assigned',
  'returned_for_defects',
  'cure_deadline',
  'numbered',
] as const;

/**
 * A registry notice read from a supplied document (SR number, defect return, cure deadline,
 * numbering). Always a proposal with an anchor, never a state change.
 */
export const RegistryEventSchema = z.object({
  kind: z.enum(REGISTRY_EVENT_KINDS),
  anchor: AnchorSchema,
  confidence: ConfidenceSchema,
  srNo: z.string().min(1).optional(),
  caseRef: CaseRefSchema.optional(),
  deadline: z
    .object({
      n: z.number().int().positive(),
      unit: z.enum(['days', 'weeks', 'months']),
      basisDate: z.string().nullable(),
      derived: z.string().nullable(),
    })
    .optional(),
});
export type RegistryEvent = z.infer<typeof RegistryEventSchema>;

/**
 * An official page the lawyer opens in a new window; structurally core's `OpenInNewWindow`
 * (packages/core/src/court/deep-links.ts). The product never fetches it.
 */
export const DeepLinkSchema = z.object({
  url: z.url({ protocol: /^https$/ }),
  fallbacks: z.array(z.url({ protocol: /^https$/ })),
  target: z.literal('_blank'),
  rel: z.literal('noopener noreferrer'),
});
export type DeepLink = z.infer<typeof DeepLinkSchema>;

/**
 * The parse-failure signal for the app. The UI renders it as the banner "Couldn't read today's
 * list for Hall X. Open the official list, or share it again." with `deepLink` opening the
 * official list in a new window (courts UI, #42). `deepLink` is null when the forum has none.
 */
export const ListUnreadableSchema = z.object({
  kind: z.literal('list_unreadable'),
  forumCode: z.string().min(1),
  hallNo: z.string().min(1).optional(),
  deepLink: DeepLinkSchema.nullable(),
});
export type ListUnreadable = z.infer<typeof ListUnreadableSchema>;

/**
 * What `buildDeepLink` can open: the access-mode resources plus link-only pages (certified-copy
 * portal, AIMS) that are never read, so they need no access mode.
 */
export const DEEP_LINK_TARGETS = [...RESOURCES, 'e_copy', 'aims'] as const;
export const DeepLinkTargetSchema = z.enum(DEEP_LINK_TARGETS);
export type DeepLinkTarget = z.infer<typeof DeepLinkTargetSchema>;

export const DeepLinkParamsSchema = z.record(z.string(), z.string());
export type DeepLinkParams = z.infer<typeof DeepLinkParamsSchema>;

/** Adapter ids: dotted lower-case slugs, e.g. `echo` or `in.tn.madras-hc.principal`. */
export const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

/** The data half of an adapter: identity, declared access modes and its versioned config. */
export const CourtAdapterDescriptorSchema = z.object({
  id: z.string().regex(ADAPTER_ID_PATTERN, 'adapter id must be dotted lower-case slugs'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver'),
  forumCodes: z.array(z.string().min(1)).min(1),
  accessModes: AccessModesSchema,
});

/**
 * A court adapter: identity, declared access modes, the config sections it parses with, and pure
 * parsers. `parseCauseList` is async so later readers can await layout work; it still performs no
 * I/O. `buildDeepLink` returns null when the forum has no page for the target.
 */
export interface CourtAdapter {
  readonly id: string;
  readonly version: string;
  readonly forumCodes: readonly string[];
  readonly accessModes: AccessModes;
  readonly nomenclature: AdapterConfig['nomenclature'];
  readonly listing: AdapterConfig['listing'];
  readonly orderParser: AdapterConfig['orderParser'];
  readonly calendar: AdapterConfig['calendar'];
  readonly languageProfile: AdapterConfig['languageProfile'];
  readonly links: AdapterConfig['links'];
  readonly fixtures: AdapterConfig['fixtures'];
  readonly health: AdapterConfig['health'];
  parseCauseList(input: ParserInput): Promise<ParsedCauseList>;
  parseOrderHeader(input: ParserInput): ParsedOrderHeader;
  findDirectionCues(input: ParserInput): DirectionCue[];
  buildDeepLink(target: DeepLinkTarget, params: DeepLinkParams): DeepLink | null;
}
