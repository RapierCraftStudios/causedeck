// Bulk judgment import progress for the Data Ops console (#890, D-053): one row per dataset archive
// with its resume position and counts. Counts, years and object keys only, never document content.
import { schema, type Queryable } from '@causedeck/db';

const { corpusImportCursor, corpusOcrQueue } = schema;
import { asc, desc, isNotNull, sql } from 'drizzle-orm';

export interface BulkImportProgress {
  sourceId: string;
  dataset: 'sc' | 'hc';
  court: string | null;
  year: number;
  status: 'pending' | 'running' | 'complete' | 'failed';
  position: number;
  rowsAdded: number;
  duplicatesSkipped: number;
  failures: number;
  bytesStored: number;
  updatedAt: Date;
}

/** Every archive the importer has reached, newest dataset year first. */
export async function listBulkImports(db: Queryable): Promise<BulkImportProgress[]> {
  const rows = await db
    .select()
    .from(corpusImportCursor)
    .orderBy(
      asc(corpusImportCursor.dataset),
      asc(corpusImportCursor.court),
      desc(corpusImportCursor.year),
    );
  return rows.map((r) => ({
    sourceId: r.sourceId,
    dataset: r.dataset,
    court: r.court,
    year: r.year,
    status: r.status,
    position: r.position,
    rowsAdded: r.rowsAdded,
    duplicatesSkipped: r.duplicatesSkipped,
    failures: r.failures,
    bytesStored: r.bytesStored,
    updatedAt: r.updatedAt,
  }));
}

/** A judgment page OCR gave up on (#1030): ids and the error code, never page content. */
export interface ParkedOcrPage {
  judgmentId: string;
  pageNo: number;
  attempts: number;
  lastError: string | null;
  parkedAt: Date;
}

export interface OcrQueueStats {
  /** Pages still waiting or retrying. */
  depth: number;
  /** Pages parked after their last attempt, kept with their error. */
  parked: number;
  /** The newest parked pages. */
  failures: ParkedOcrPage[];
}

/** Queue depth and parked failures of the corpus OCR drain, for the Data Ops console. */
export async function ocrQueueStats(db: Queryable, limit = 20): Promise<OcrQueueStats> {
  const [counts] = await db
    .select({
      depth: sql<number>`count(*) filter (where ${corpusOcrQueue.parkedAt} is null)::int`,
      parked: sql<number>`count(*) filter (where ${corpusOcrQueue.parkedAt} is not null)::int`,
    })
    .from(corpusOcrQueue);
  const failures = await db
    .select({
      judgmentId: corpusOcrQueue.judgmentId,
      pageNo: corpusOcrQueue.pageNo,
      attempts: corpusOcrQueue.attempts,
      lastError: corpusOcrQueue.lastError,
      parkedAt: corpusOcrQueue.parkedAt,
    })
    .from(corpusOcrQueue)
    .where(isNotNull(corpusOcrQueue.parkedAt))
    .orderBy(desc(corpusOcrQueue.parkedAt))
    .limit(limit);
  return {
    depth: counts?.depth ?? 0,
    parked: counts?.parked ?? 0,
    failures: failures.map((f) => ({ ...f, parkedAt: f.parkedAt as Date })),
  };
}
