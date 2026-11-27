// The HF text importer (#1171, D-053): reads the Hugging Face dataset `overthelex/indian-court-decisions`
// one row group at a time, drops rows below the text-quality floor, stores each distinct text once
// (normalised text hash) and records every further CNR of an already stored text as an alias. Texts
// are anonymised through `redactJudgment` before anything is written; the raw `full_text` is never
// stored (`page_text` stays empty, `redacted_text` is one pseudo-page) and the row waits for its PDF
// (`pinpoint_state = pending-pdf`, #1173). Each Parquet file has a cursor row (`corpus_import_cursor`,
// dataset `hf`): `position` counts the file's rows already handled, so an interrupted run continues
// after them and a re-run inserts nothing twice. Only ids, counts and keys are reported.
import { createHash } from 'node:crypto';

import { schema, type Queryable } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import { redactJudgment } from '../redact/index.ts';

import {
  HF_COLUMNS,
  HF_CONFIGS,
  HF_FILTER_COLUMNS,
  inSlice,
  mapHfRow,
  type HfDataset,
  type HfMappedRow,
  type HfSliceFilter,
} from './map.ts';
import { qualityDrop, textHash, type HfQualityDrop } from './quality.ts';
import type { HfDatasetSource, HfParquetFile } from './reader.ts';

const { corpusImportCursor, judgment, judgmentCnrAlias } = schema;

/** The registry source of the dataset (migration 20261031181222). */
export const HF_SOURCE_ID = 'hf-overthelex';
export const HF_LICENCE = 'CC-BY-4.0';
export const HF_ATTRIBUTION = 'Dattam Labs via overthelex/indian-court-decisions, CC-BY-4.0';

export interface HfImportRequest extends HfSliceFilter {
  dataset: HfDataset;
  /** The source's base URL (`https://huggingface.co/datasets/<owner>/<name>/`). */
  baseUrl: string;
}

/** A run stops once `maxRows` in-slice rows were handled or `maxBytes` were read. */
export interface HfBudget {
  maxRows: number;
  maxBytes: number;
}

/** A bounded slice: well under 1 GB read per run. */
export const DEFAULT_HF_BUDGET: HfBudget = { maxRows: 5_000, maxBytes: 512 * 1024 ** 2 };

export interface HfImportReport {
  files: number;
  /** In-slice rows handled (inserted, deduplicated or dropped). */
  rows: number;
  inserted: number;
  /** Rows whose normalised text was already stored. */
  duplicates: number;
  /** Further CNRs recorded for an already stored text. */
  aliases: number;
  /** Rows dropped by reason: no text, or below the quality floor. */
  dropped: Record<HfQualityDrop | 'empty', number>;
  failed: number;
  bytes: number;
  budgetReached: boolean;
}

/** One file's cursor. */
export interface HfCursor {
  id: string;
  position: number;
  status: string;
}

/** The persistence the importer needs; `drizzleHfImportStore` is the database implementation. */
export interface HfImportStore {
  cursor(input: {
    sourceId: string;
    court: string | null;
    year: number;
    archiveKey: string;
  }): Promise<HfCursor>;
  advance(
    cursorId: string,
    position: number,
    delta: { added: number; dupes: number; failed: number },
  ): Promise<void>;
  complete(cursorId: string): Promise<void>;
  /** The judgment holding this normalised text, if any. */
  findByTextHash(hash: string): Promise<{ id: string; cnr: string | null } | null>;
  /** Whether the CNR is already a judgment's CNR or an alias. */
  cnrKnown(cnr: string): Promise<boolean>;
  /** Insert one judgment; null when a concurrent run stored the same text first. */
  insertJudgment(values: typeof judgment.$inferInsert): Promise<string | null>;
  addAlias(alias: { cnr: string; judgmentId: string; sourceId: string }): Promise<void>;
}

export function drizzleHfImportStore(db: Queryable): HfImportStore {
  return {
    async cursor(input) {
      await db
        .insert(corpusImportCursor)
        .values({ ...input, dataset: 'hf' })
        .onConflictDoNothing();
      const [row] = await db
        .select({
          id: corpusImportCursor.id,
          position: corpusImportCursor.position,
          status: corpusImportCursor.status,
        })
        .from(corpusImportCursor)
        .where(
          and(
            eq(corpusImportCursor.sourceId, input.sourceId),
            eq(corpusImportCursor.archiveKey, input.archiveKey),
          ),
        )
        .limit(1);
      if (row === undefined) throw new Error('corpus_import_cursor row missing');
      return row;
    },
    async advance(cursorId, position, delta) {
      await db
        .update(corpusImportCursor)
        .set({
          position,
          status: 'running',
          rowsAdded: sql`${corpusImportCursor.rowsAdded} + ${delta.added}`,
          duplicatesSkipped: sql`${corpusImportCursor.duplicatesSkipped} + ${delta.dupes}`,
          failures: sql`${corpusImportCursor.failures} + ${delta.failed}`,
          updatedAt: new Date(),
        })
        .where(eq(corpusImportCursor.id, cursorId));
    },
    async complete(cursorId) {
      await db
        .update(corpusImportCursor)
        .set({ status: 'complete', updatedAt: new Date() })
        .where(eq(corpusImportCursor.id, cursorId));
    },
    async findByTextHash(hash) {
      const [row] = await db
        .select({ id: judgment.id, cnr: judgment.cnr })
        .from(judgment)
        .where(eq(judgment.textHash, hash))
        .limit(1);
      return row ?? null;
    },
    async cnrKnown(cnr) {
      const [own] = await db
        .select({ id: judgment.id })
        .from(judgment)
        .where(eq(judgment.cnr, cnr))
        .limit(1);
      if (own !== undefined) return true;
      const [alias] = await db
        .select({ id: judgmentCnrAlias.id })
        .from(judgmentCnrAlias)
        .where(eq(judgmentCnrAlias.cnr, cnr))
        .limit(1);
      return alias !== undefined;
    },
    async insertJudgment(values) {
      const [row] = await db
        .insert(judgment)
        .values(values)
        .onConflictDoNothing({ target: judgment.sha256 })
        .returning({ id: judgment.id });
      return row?.id ?? null;
    },
    async addAlias(alias) {
      await db.insert(judgmentCnrAlias).values(alias).onConflictDoNothing();
    },
  };
}

export interface HfImportDeps {
  store: HfImportStore;
  source: HfDatasetSource;
  now?: () => Date;
}

/** The dedupe key of a text-only row: namespaced, so it never equals a PDF's sha256 (K1). */
export const hfJudgmentSha256 = (hash: string): string =>
  createHash('sha256').update(`${HF_SOURCE_ID}:${hash}`).digest('hex');

/** The cursor key of a file in a slice: a different court or year range keeps its own position. */
export function hfArchiveKey(file: HfParquetFile, filter: HfSliceFilter): string {
  const parts: string[] = [];
  if (filter.court !== undefined) parts.push(`court=${filter.court.toLowerCase()}`);
  if (filter.yearFrom !== undefined || filter.yearTo !== undefined)
    parts.push(`years=${String(filter.yearFrom ?? '')}-${String(filter.yearTo ?? '')}`);
  return parts.length === 0 ? file.path : `${file.path}#${parts.join(';')}`;
}

/** Party names to remove from the text: petitioner, respondent and the two sides of the title. */
function partyNames(row: HfMappedRow): string[] {
  const names = [row.petitioner, row.respondent];
  if (row.title !== null) names.push(...row.title.split(/\s+(?:vs?\.?|versus)\s+/i));
  return [
    ...new Set(
      names
        .filter((n): n is string => n !== null)
        .map((n) => n.replace(/\s*\(.*\)\s*$/, '').trim())
        .filter((n) => /\p{L}{2,}/u.test(n)),
    ),
  ];
}

/** The judgment row of one mapped text, anonymised (D-053). Exported for tests. */
export function hfJudgmentValues(
  row: HfMappedRow,
  hash: string,
  provenance: { url: string; fetchedAt: string },
): typeof judgment.$inferInsert {
  const extraNames = partyNames(row);
  const redacted = redactJudgment({
    pages: [{ pageNo: 1, text: row.text }],
    bench: row.bench,
    extraNames,
  });
  // The title printed in the text wins (the PDF path); else the dataset's title, masked alike.
  let caseTitle = redacted.caseTitle;
  if (caseTitle === null && row.title !== null) {
    caseTitle = redacted.titleMasked
      ? (redactJudgment({
          pages: [{ pageNo: 1, text: row.title }],
          extraNames,
          forceMask: { reason: redacted.maskReason ?? 'auto' },
        }).pages[0]?.text ?? null)
      : row.title;
  }
  const sha256 = hfJudgmentSha256(hash);
  return {
    sourceId: HF_SOURCE_ID,
    court: row.courtName ?? row.courtCode ?? HF_SOURCE_ID,
    neutralCitation: null,
    caseNumbers: [],
    bench: row.bench,
    judgmentDate: row.judgmentDate,
    sha256,
    provenance: {
      url: provenance.url,
      fetchedAt: provenance.fetchedAt,
      sha256,
      sourceId: HF_SOURCE_ID,
      sourceVersion: 'hf-overthelex',
      tierUsed: 'http',
      costDollars: 0,
      licence: HF_LICENCE,
    },
    // K1: the raw text is never stored; anchors wait for the PDF (#1173).
    pageText: [],
    redactedText: redacted.pages.map((p) => ({
      pageNo: p.pageNo,
      text: p.text,
      source: 'text' as const,
    })),
    caseTitle,
    titleMasked: redacted.titleMasked,
    redactionVersion: redacted.redactionVersion,
    sensitiveCategory: redacted.sensitiveCategory,
    maskReason: redacted.maskReason,
    cnr: row.cnr,
    textHash: hash,
    pinpointState: 'pending-pdf',
    licence: HF_LICENCE,
    attribution: HF_ATTRIBUTION,
  };
}

/** Import the files of the request until done, aborted or the budget is reached. */
export async function runHfImport(
  deps: HfImportDeps,
  request: HfImportRequest,
  budget: HfBudget = DEFAULT_HF_BUDGET,
  signal?: AbortSignal,
): Promise<HfImportReport> {
  const report: HfImportReport = {
    files: 0,
    rows: 0,
    inserted: 0,
    duplicates: 0,
    aliases: 0,
    dropped: { empty: 0, short: 0, repeated: 0, garbled: 0 },
    failed: 0,
    bytes: 0,
    budgetReached: false,
  };
  const now = deps.now ?? (() => new Date());
  const startBytes = deps.source.bytesRead();
  const readBytes = (): number => deps.source.bytesRead() - startBytes;
  const exhausted = (): boolean =>
    report.rows >= budget.maxRows || readBytes() >= budget.maxBytes || signal?.aborted === true;
  const filter: HfSliceFilter = {
    court: request.court,
    yearFrom: request.yearFrom,
    yearTo: request.yearTo,
  };
  const config = HF_CONFIGS[request.dataset];

  files: for (const file of await deps.source.list(config)) {
    if (exhausted()) {
      report.budgetReached = true;
      break;
    }
    const cursor = await deps.store.cursor({
      sourceId: HF_SOURCE_ID,
      court: request.court ?? null,
      year: request.yearFrom ?? 0,
      archiveKey: hfArchiveKey(file, filter),
    });
    if (cursor.status === 'complete') continue;
    report.files += 1;
    const opened = await deps.source.open(file);
    const fetchedAt = now().toISOString();
    let groupStart = 0;
    for (const groupRows of opened.rowGroups) {
      const groupEnd = groupStart + groupRows;
      const from = Math.max(groupStart, cursor.position);
      groupStart = groupEnd;
      if (from >= groupEnd) continue; // handled by an earlier run
      if (exhausted()) {
        report.budgetReached = true;
        break files;
      }
      // Filter columns first: a row group with nothing in the slice never has its texts read.
      const keys = await opened.readRows(from, groupEnd, HF_FILTER_COLUMNS);
      const wanted = keys.map((k) => inSlice(k, filter, now()));
      const delta = { added: 0, dupes: 0, failed: 0 };
      let position = groupEnd;
      if (wanted.some(Boolean)) {
        const rows = await opened.readRows(from, groupEnd, HF_COLUMNS);
        for (const [i, raw] of rows.entries()) {
          if (wanted[i] !== true) continue;
          if (exhausted()) {
            position = from + i;
            break;
          }
          report.rows += 1;
          const mapped = mapHfRow(raw, now());
          if (mapped === null) {
            report.dropped.empty += 1;
            continue;
          }
          const drop = qualityDrop(mapped.text);
          if (drop !== null) {
            report.dropped[drop] += 1;
            continue;
          }
          try {
            const hash = textHash(mapped.text);
            const existing = await deps.store.findByTextHash(hash);
            if (existing !== null) {
              delta.dupes += 1;
              if (
                mapped.cnr !== null &&
                mapped.cnr !== existing.cnr &&
                !(await deps.store.cnrKnown(mapped.cnr))
              ) {
                await deps.store.addAlias({
                  cnr: mapped.cnr,
                  judgmentId: existing.id,
                  sourceId: HF_SOURCE_ID,
                });
                report.aliases += 1;
              }
              continue;
            }
            const id = await deps.store.insertJudgment(
              hfJudgmentValues(mapped, hash, {
                url: `${request.baseUrl}blob/main/${file.path}#row=${String(from + i)}`,
                fetchedAt,
              }),
            );
            if (id === null) delta.dupes += 1;
            else delta.added += 1;
          } catch {
            delta.failed += 1;
          }
        }
      }
      report.inserted += delta.added;
      report.duplicates += delta.dupes;
      report.failed += delta.failed;
      await deps.store.advance(cursor.id, position, delta);
      cursor.position = position;
      if (position < groupEnd) {
        report.budgetReached = true;
        break files;
      }
    }
    await deps.store.complete(cursor.id);
  }
  report.bytes = readBytes();
  return report;
}
