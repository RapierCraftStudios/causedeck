// Bulk judgment import progress for the Data Ops console (#890, D-053): one row per dataset archive
// with its resume position and counts. Counts, years and object keys only, never document content.
import { schema, type Queryable } from '@causedeck/db';

const { corpusImportCursor } = schema;
import { asc, desc } from 'drizzle-orm';

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
