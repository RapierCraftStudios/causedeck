// Ports of the bulk importer (#890): the dataset bucket and the metadata reader are injected, so
// tests run on a tiny in-memory archive and nothing here depends on a network client.

/** Read access to the dataset bucket. Keys are bucket keys, never URLs. */
export interface BulkObjectSource {
  /** Every object key under `prefix`. */
  list(prefix: string): Promise<string[]>;
  /** A whole small object (the metadata Parquet). */
  read(key: string): Promise<Uint8Array>;
  /** An archive, in chunks. */
  stream(key: string): AsyncIterable<Uint8Array>;
}

export type BulkDataset = 'sc' | 'hc';

export interface BulkImportRequest {
  dataset: BulkDataset;
  /** The registry source (`aws-open-data-sc`, `aws-open-data-hc`). */
  sourceId: string;
  /** Source base URL; provenance URLs are built on it. */
  baseUrl: string;
  /** High Court only: the court path segment, e.g. `33_10`. */
  court?: string | undefined;
  yearFrom?: number | undefined;
  yearTo?: number | undefined;
}

/** A bound on one run; the rest waits for the next run, resuming from the cursors. */
export interface BulkBudget {
  maxPages: number;
  maxBytes: number;
}

export interface BulkImportReport {
  archives: number;
  inserted: number;
  duplicates: number;
  failed: number;
  pages: number;
  bytes: number;
  /** True when the run stopped on its page or byte budget before finishing every archive. */
  budgetReached: boolean;
}
