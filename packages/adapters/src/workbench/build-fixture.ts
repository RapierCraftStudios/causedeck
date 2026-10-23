// The fixture builder behind the staff workbench (#516). It parses a contributed document with an
// adapter, applies the corrections a labeler made to the parser's output, redacts the document and
// the expected output together (redact.ts) and refuses to return anything that still holds a
// known party name or personal data (detect.ts). The raw document is never part of the result.
import { z } from 'zod';

import { layoutFromEmail } from '../layout/email.ts';
import { layoutFromHtml } from '../layout/html.ts';
import {
  ParsedCauseListSchema,
  type CourtAdapter,
  type ParsedCauseList,
  type ParsedListRow,
  type ParserInput,
} from '../types.ts';
import { findLeaks } from './detect.ts';
import { createRedactor, partyNames } from './redact.ts';

/** `receivedAt` of every golden input; a test keeps it equal to `GOLDEN_RECEIVED_AT`. */
export const WORKBENCH_RECEIVED_AT = '2026-10-21T04:00:00.000Z';

export const WORKBENCH_FORMATS = ['text', 'html', 'email'] as const;
export type WorkbenchFormat = (typeof WORKBENCH_FORMATS)[number];
const EXTENSIONS: Record<WorkbenchFormat, string> = { text: 'txt', html: 'html', email: 'eml' };

export class WorkbenchError extends Error {
  override name = 'WorkbenchError';
}

const FIXTURE_NAME = /^[a-z0-9][a-z0-9.-]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The row fields a labeler may correct. */
export const EDITABLE_ROW_FIELDS = [
  'itemNo',
  'hallNo',
  'bench',
  'caseTypeRaw',
  'caseType',
  'caseNumber',
  'caseYear',
  'matchKey',
  'parties',
  'stageRaw',
  'stageNorm',
] as const;

const RowPatchSchema = z
  .object({
    itemNo: z.string(),
    hallNo: z.string(),
    bench: z.string(),
    caseTypeRaw: z.string(),
    caseType: z.string().nullable(),
    caseNumber: z.string().nullable(),
    caseYear: z.number().int().nullable(),
    matchKey: z.string().nullable(),
    parties: z.string(),
    stageRaw: z.string().nullable(),
    stageNorm: z.string().nullable(),
  })
  .partial()
  .strict();

const RowRefSchema = z.object({ page: z.number().int().positive(), quote: z.string().min(1) });

export const FixtureCorrectionsSchema = z.object({
  listDate: z.string().regex(ISO_DATE).nullable().optional(),
  /** Rows are identified by their anchor, which the parser never changes. */
  rows: z.array(z.object({ anchor: RowRefSchema, patch: RowPatchSchema })).default([]),
  removeRows: z.array(RowRefSchema).default([]),
});
export type FixtureCorrections = z.input<typeof FixtureCorrectionsSchema>;

const rowKey = (ref: { page: number; quote: string }) => `${String(ref.page)}\u0000${ref.quote}`;

function patchRow(row: ParsedListRow, patches: Map<string, z.infer<typeof RowPatchSchema>>) {
  const patch = patches.get(rowKey(row.anchor));
  return patch === undefined ? row : { ...row, ...patch };
}

/** `parsed` with the labeler's corrections applied (rows and the hall-grouped copy alike). */
export function applyCorrections(
  parsed: ParsedCauseList,
  corrections: FixtureCorrections = {},
): ParsedCauseList {
  const { listDate, rows, removeRows } = FixtureCorrectionsSchema.parse(corrections);
  const known = new Set(parsed.rows.map((row) => rowKey(row.anchor)));
  const patches = new Map(rows.map((r) => [rowKey(r.anchor), r.patch]));
  const removed = new Set(removeRows.map(rowKey));
  for (const key of [...patches.keys(), ...removed]) {
    if (!known.has(key)) throw new WorkbenchError('A correction names a row the parser did not emit');
  }
  const keep = (row: ParsedListRow) => !removed.has(rowKey(row.anchor));
  const next = (row: ParsedListRow) => patchRow(row, patches);
  return ParsedCauseListSchema.parse({
    ...parsed,
    ...(listDate === undefined ? {} : { listDate }),
    rows: parsed.rows.filter(keep).map(next),
    ...(parsed.halls === undefined
      ? {}
      : {
          halls: parsed.halls.map((hall) => ({
            ...hall,
            lists: hall.lists.map((list) => ({ ...list, rows: list.rows.filter(keep).map(next) })),
          })),
        }),
  });
}

/** An edited cell, as a form posts it, mapped back onto the row field's type; null for no change. */
function editedValue(field: (typeof EDITABLE_ROW_FIELDS)[number], raw: string) {
  const text = raw.trim();
  if (field === 'caseYear') return text === '' ? null : Number.parseInt(text, 10);
  if (['caseType', 'caseNumber', 'matchKey', 'stageRaw', 'stageNorm'].includes(field)) {
    return text === '' ? null : text;
  }
  return text;
}

/**
 * The corrections a form posts: `listDate` and, per parsed row (same order), the edited cell values
 * as strings. Only cells that differ from the parser's output become patches; an emptied optional
 * text cell (hall, bench, item, parties) is left alone, since the schema has no way to unset it.
 */
export function correctionsFromEdits(
  parsed: ParsedCauseList,
  edits: { listDate?: string; rows: Record<string, string>[] },
): FixtureCorrections {
  const rows: NonNullable<FixtureCorrections['rows']> = [];
  parsed.rows.forEach((row, index) => {
    const edited = edits.rows[index];
    if (edited === undefined) return;
    const patch: Record<string, string | number | null> = {};
    for (const field of EDITABLE_ROW_FIELDS) {
      const raw = edited[field];
      if (raw === undefined || raw.trim() === String(row[field] ?? '')) continue;
      const value = editedValue(field, raw);
      if (value === '' && row[field] === undefined) continue;
      if (value === '' && ['itemNo', 'hallNo', 'bench', 'parties'].includes(field)) continue;
      patch[field] = value;
    }
    if (Object.keys(patch).length > 0) {
      rows.push({
        anchor: { page: row.anchor.page, quote: row.anchor.quote },
        patch: patch as z.infer<typeof RowPatchSchema>,
      });
    }
  });
  const listDate = edits.listDate?.trim();
  return {
    rows,
    ...(listDate === undefined || listDate === (parsed.listDate ?? '')
      ? {}
      : { listDate: listDate === '' ? null : listDate }),
  };
}

/** The parser input for a document of `format`; `forumCode` defaults to the adapter's first. */
export function toParserInput(
  adapter: CourtAdapter,
  format: WorkbenchFormat,
  content: string,
  forumCode: string = adapter.forumCodes[0] ?? '',
): ParserInput {
  const meta = { receivedAt: WORKBENCH_RECEIVED_AT, forumCode };
  if (format === 'html') return { kind: 'html', html: content, layout: layoutFromHtml(content), meta };
  if (format === 'email') {
    return { kind: 'email', text: content, layout: layoutFromEmail(content), meta };
  }
  return { kind: 'text', text: content, meta };
}

/** The page texts anchors quote from. */
function pagesOf(input: ParserInput): string[] {
  if (input.layout !== undefined) return input.layout.pages.map((page) => page.text);
  return (input.text ?? '').split('\f');
}

/** Run the adapter on a document and return its schema-checked output. */
export async function previewDocument(
  adapter: CourtAdapter,
  format: WorkbenchFormat,
  content: string,
  forumCode?: string,
): Promise<ParsedCauseList> {
  const input = toParserInput(adapter, format, content, forumCode);
  return ParsedCauseListSchema.parse(await adapter.parseCauseList(input));
}

export interface BuildFixtureInput {
  adapter: CourtAdapter;
  /** The fixture's base name: `list-12-shorthand`. */
  name: string;
  format: WorkbenchFormat;
  /** The contributed document, as text. */
  content: string;
  forumCode?: string;
  corrections?: FixtureCorrections;
  /** Names the parser did not report (advocates, judges' clerks, anyone else) to replace too. */
  extraNames?: string[];
}

/** A redacted fixture, ready to write under `fixtures/<adapterId>/`. */
export const FixtureBundleSchema = z.object({
  adapterId: z.string().min(1),
  inputFile: z.string().regex(/^[\w.-]+\.input\.(txt|html|eml)$/),
  inputContent: z.string(),
  expected: ParsedCauseListSchema,
  manifestEntry: z.object({
    file: z.string().min(1),
    kind: z.literal('cause_list'),
    origin: z.literal('lawyer-supplied'),
    classification: z.literal('REDACTED'),
    forumCode: z.string().min(1).optional(),
  }),
});
export type FixtureBundle = z.infer<typeof FixtureBundleSchema>;

export interface BuiltFixture {
  bundle: FixtureBundle;
  redactions: { names: number; pii: number };
  /** The adapter, run on the redacted input, reproduces the redacted expected output. */
  reparseMatches: boolean;
}

/**
 * Build a redacted fixture. Throws `WorkbenchError` for a bad name or correction, for an anchor the
 * redaction broke, and for any real name or personal data that survives redaction.
 */
export async function buildFixture(options: BuildFixtureInput): Promise<BuiltFixture> {
  const { adapter, name, format, content } = options;
  if (!FIXTURE_NAME.test(name)) {
    throw new WorkbenchError('Fixture names use lower-case letters, digits, dots and hyphens');
  }
  const forumCode = options.forumCode ?? adapter.forumCodes[0] ?? '';
  const parsed = await previewDocument(adapter, format, content, forumCode);
  const corrected = applyCorrections(parsed, options.corrections);
  const names = [
    ...parsed.rows.flatMap((row) => partyNames(row.parties)),
    ...corrected.rows.flatMap((row) => partyNames(row.parties)),
    ...(options.extraNames ?? []),
  ];
  const redactor = createRedactor(names, content);
  const inputContent = redactor.text(content);
  const expected = ParsedCauseListSchema.parse(redactor.deep(corrected));

  const pages = pagesOf(toParserInput(adapter, format, inputContent, forumCode));
  for (const row of expected.rows) {
    if (pages[row.anchor.page - 1]?.includes(row.anchor.quote) !== true) {
      throw new WorkbenchError(`Redaction moved the anchor of "${row.anchor.quote.slice(0, 40)}"`);
    }
  }
  const leaks = [
    ...findLeaks(inputContent, redactor.names),
    ...findLeaks(JSON.stringify(expected), redactor.names),
  ];
  if (leaks.length > 0) {
    const kinds = [...new Set(leaks.map((leak) => leak.kind))].join(', ');
    throw new WorkbenchError(`Redaction left personal data in the fixture (${kinds})`);
  }

  const reparsed = await previewDocument(adapter, format, inputContent, forumCode);
  const inputFile = `${name}.input.${EXTENSIONS[format]}`;
  return {
    bundle: {
      adapterId: adapter.id,
      inputFile,
      inputContent,
      expected,
      manifestEntry: {
        file: inputFile,
        kind: 'cause_list',
        origin: 'lawyer-supplied',
        classification: 'REDACTED',
        ...(forumCode === adapter.forumCodes[0] ? {} : { forumCode }),
      },
    },
    redactions: redactor.counts(),
    reparseMatches:
      options.corrections === undefined &&
      JSON.stringify(reparsed) === JSON.stringify(expected),
  };
}
