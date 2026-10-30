// The bulk importer (#890, D-053): walks the archives of one open dataset (Supreme Court or High
// Court judgments, CC-BY-4.0), reads each PDF with the existing text-layer code and stores it through
// `storeJudgment`, the same path as `corpus.poll`, so sha256 dedupe, blob upload and OCR queueing are
// shared. Each archive has a cursor row (`corpus_import_cursor`): `position` counts the entries
// already handled, so an interrupted run continues after them and a re-run adds nothing. Only ids,
// counts and keys are ever reported.
import { createHash } from 'node:crypto';

import { schema, type Queryable } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import { storeJudgment, type StoreDeps } from '../ingest.ts';

import { indexMetadata, type BulkMetadata } from './metadata.ts';
import { readParquetRows } from './parquet.ts';
import { gunzipIfNeeded, readTar } from './tar.ts';
import type {
  BulkBudget,
  BulkImportReport,
  BulkImportRequest,
  BulkObjectSource,
} from './types.ts';

const { corpusImportCursor } = schema;

/** Attribution and licence of the two datasets (D-053 item 4); the public pages repeat this text. */
export const BULK_LICENCE = 'CC-BY-4.0';
export const BULK_ATTRIBUTION =
  'Dattam Labs, Indian Supreme Court and High Court Judgments, AWS Open Data, CC-BY-4.0';

/** PDFs processed at once within an archive. */
export const BULK_DEFAULT_CONCURRENCY = 4;

export interface BulkImportDeps extends StoreDeps {
  db: Queryable;
  objects: BulkObjectSource;
  /** Reads the metadata Parquet; defaults to `hyparquet`. */
  parquet?: typeof readParquetRows;
  concurrency?: number;
  now?: () => Date;
}

export const DEFAULT_BULK_BUDGET: BulkBudget = { maxPages: 50_000, maxBytes: 2 * 1024 ** 3 };

/** The data prefix of the dataset's tar archives. */
const DATA_PREFIX = 'data/tar/';
const METADATA_PREFIX = 'metadata/parquet/';

/** The year in a `year=YYYY` path segment. */
const yearOf = (key: string): number | null => {
  const match = /(?:^|\/)year=(\d{4})(?:\/|$)/.exec(key);
  return match?.[1] === undefined ? null : Number(match[1]);
};

/** Archive keys of the request: tar files in the year range (and for the court), in key order. */
export async function listArchives(
  objects: BulkObjectSource,
  request: BulkImportRequest,
): Promise<{ key: string; year: number }[]> {
  const years: (number | null)[] = [];
  if (request.yearFrom !== undefined && request.yearTo !== undefined) {
    for (let y = request.yearFrom; y <= request.yearTo; y += 1) years.push(y);
  } else {
    years.push(null);
  }
  const found: { key: string; year: number }[] = [];
  for (const year of years) {
    const prefix = year === null ? DATA_PREFIX : `${DATA_PREFIX}year=${String(year)}/`;
    for (const key of await objects.list(prefix)) {
      if (!/\.(tar|tar\.gz|tgz)$/i.test(key)) continue;
      const keyYear = yearOf(key);
      if (keyYear === null) continue;
      if (request.yearFrom !== undefined && keyYear < request.yearFrom) continue;
      if (request.yearTo !== undefined && keyYear > request.yearTo) continue;
      if (request.court !== undefined && !key.includes(`court=${request.court}`)) continue;
      found.push({ key, year: keyYear });
    }
  }
  return found.sort((a, b) => a.key.localeCompare(b.key));
}

/** Where the metadata Parquet of an archive lives: the same path under `metadata/parquet/`. */
export function metadataKey(archiveKey: string): string {
  const dir = archiveKey.slice(DATA_PREFIX.length).split('/').slice(0, -1).join('/');
  return `${METADATA_PREFIX}${dir}/metadata.parquet`;
}

async function loadMetadata(
  deps: BulkImportDeps,
  archiveKey: string,
): Promise<Map<string, BulkMetadata>> {
  try {
    const bytes = await deps.objects.read(metadataKey(archiveKey));
    return indexMetadata(await (deps.parquet ?? readParquetRows)(bytes));
  } catch {
    // No readable metadata: the header extracted from the PDF text fills the fields.
    return new Map();
  }
}

type CursorRow = typeof corpusImportCursor.$inferSelect;

async function cursorFor(
  db: Queryable,
  request: BulkImportRequest,
  archive: { key: string; year: number },
): Promise<CursorRow> {
  await db
    .insert(corpusImportCursor)
    .values({
      sourceId: request.sourceId,
      dataset: request.dataset,
      court: request.court ?? null,
      year: archive.year,
      archiveKey: archive.key,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(corpusImportCursor)
    .where(
      and(
        eq(corpusImportCursor.sourceId, request.sourceId),
        eq(corpusImportCursor.archiveKey, archive.key),
      ),
    )
    .limit(1);
  if (row === undefined) throw new Error('corpus_import_cursor row missing');
  return row;
}

/** Import every archive of the request until done or the budget is reached. */
export async function runBulkImport(
  deps: BulkImportDeps,
  request: BulkImportRequest,
  budget: BulkBudget = DEFAULT_BULK_BUDGET,
  signal?: AbortSignal,
): Promise<BulkImportReport> {
  const report: BulkImportReport = {
    archives: 0,
    inserted: 0,
    duplicates: 0,
    failed: 0,
    pages: 0,
    bytes: 0,
    budgetReached: false,
  };
  const concurrency = Math.max(1, deps.concurrency ?? BULK_DEFAULT_CONCURRENCY);
  const exhausted = (): boolean => report.pages >= budget.maxPages || report.bytes >= budget.maxBytes;

  for (const archive of await listArchives(deps.objects, request)) {
    if (exhausted() || signal?.aborted === true) {
      report.budgetReached = true;
      break;
    }
    const cursor = await cursorFor(deps.db, request, archive);
    if (cursor.status === 'complete') continue;
    report.archives += 1;
    const metadata = await loadMetadata(deps, archive.key);
    const stamp = (deps.now ?? (() => new Date()))().toISOString();

    let position = 0;
    let finished = true;
    const batch: { name: string; data: Uint8Array }[] = [];
    const delta = { added: 0, dupes: 0, failed: 0, bytes: 0 };

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      const entries = batch.splice(0);
      const outcomes = await Promise.all(
        entries.map(async (entry) => {
          const sha256 = createHash('sha256').update(entry.data).digest('hex');
          try {
            return await storeJudgment(deps, {
              sourceId: request.sourceId,
              bytes: entry.data,
              metadata: metadata.get(entry.name) ?? {},
              provenance: {
                url: new URL(`${archive.key}#${entry.name}`, request.baseUrl).toString(),
                fetchedAt: stamp,
                sha256,
                sourceId: request.sourceId,
                sourceVersion: 'aws-open-data',
                tierUsed: 'http',
                costDollars: 0,
                licence: BULK_LICENCE,
              },
            });
          } catch {
            return null;
          }
        }),
      );
      for (const [i, outcome] of outcomes.entries()) {
        if (outcome === null || outcome.status === 'unreadable') delta.failed += 1;
        else if (outcome.status === 'duplicate') delta.dupes += 1;
        else {
          delta.added += 1;
          delta.bytes += entries[i]?.data.length ?? 0;
          report.pages += outcome.pages;
          report.bytes += entries[i]?.data.length ?? 0;
        }
      }
      position += entries.length;
      report.inserted += delta.added;
      report.duplicates += delta.dupes;
      report.failed += delta.failed;
      await deps.db
        .update(corpusImportCursor)
        .set({
          position: cursor.position + position,
          status: 'running',
          rowsAdded: sql`${corpusImportCursor.rowsAdded} + ${delta.added}`,
          duplicatesSkipped: sql`${corpusImportCursor.duplicatesSkipped} + ${delta.dupes}`,
          failures: sql`${corpusImportCursor.failures} + ${delta.failed}`,
          bytesStored: sql`${corpusImportCursor.bytesStored} + ${delta.bytes}`,
          updatedAt: new Date(),
        })
        .where(eq(corpusImportCursor.id, cursor.id));
      delta.added = delta.dupes = delta.failed = delta.bytes = 0;
    };

    let seen = 0;
    for await (const entry of readTar(
      gunzipIfNeeded(deps.objects.stream(archive.key), archive.key),
    )) {
      if (!/\.pdf$/i.test(entry.name)) continue;
      seen += 1;
      if (seen <= cursor.position) continue;
      batch.push({ name: entry.name.split('/').pop() ?? entry.name, data: entry.data });
      if (batch.length >= concurrency) {
        await flush();
        if (exhausted() || signal?.aborted === true) {
          finished = false;
          break;
        }
      }
    }
    if (finished) await flush();
    if (finished) {
      await deps.db
        .update(corpusImportCursor)
        .set({ status: 'complete', updatedAt: new Date() })
        .where(eq(corpusImportCursor.id, cursor.id));
    } else {
      report.budgetReached = true;
      break;
    }
  }
  return report;
}
