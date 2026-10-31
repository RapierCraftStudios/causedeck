// `system.corpus.bulk-import` (#890, D-053): imports the AWS Open Data Supreme Court or High Court
// judgment dataset (CC-BY-4.0, Dattam Labs) into the global `judgment` corpus. Off by default: it has
// no schedule and runs only when staff start it from the admin console, per dataset, court and year
// range. The source must be cleared (`policyFor` throws before any read), a run is bounded by a page
// and a byte budget, and the importer resumes from the per-archive cursor, so a re-run only picks up
// what is left. Only ids, counts and keys are logged.
import { serverEnv } from '@causedeck/config/env';
import { db as rootDb, type Queryable } from '@causedeck/db';
import {
  createS3HttpSource,
  DEFAULT_BULK_BUDGET,
  runBulkImport,
  type BulkImportReport,
  type BulkObjectSource,
  type CorpusBlobStore,
} from '@causedeck/intelligence';
import { corpusObjectKey, createObjectStoreFromEnv, type ObjectStore } from '@causedeck/storage';
import { z } from 'zod';

import { policyFor, SourceNotCleared } from '../../sources/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

/** The registry source of each dataset. */
export const CORPUS_BULK_SOURCES = {
  sc: 'aws-open-data-sc',
  hc: 'aws-open-data-hc',
} as const;

const year = z.number().int().min(1947).max(2100);

export const corpusBulkImportSchema = z
  .object({
    workspaceId: z.null().optional(),
    dataset: z.enum(['sc', 'hc']),
    /** High Court only: the dataset's court path segment, e.g. `33_10`. */
    court: z
      .string()
      .regex(/^[A-Za-z0-9_~-]{1,40}$/)
      .optional(),
    yearFrom: year.optional(),
    yearTo: year.optional(),
    maxPages: z.number().int().min(1).max(1_000_000).optional(),
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 ** 3)
      .optional(),
  })
  .refine((p) => (p.yearFrom === undefined) === (p.yearTo === undefined), {
    message: 'yearFrom and yearTo go together',
  })
  .refine((p) => p.yearFrom === undefined || p.yearTo === undefined || p.yearFrom <= p.yearTo, {
    message: 'yearFrom is after yearTo',
  })
  .refine((p) => p.dataset === 'hc' || p.court === undefined, {
    message: 'court applies to the High Court dataset only',
  });

export type CorpusBulkImportPayload = z.infer<typeof corpusBulkImportSchema>;

export type CorpusBulkImportReport = BulkImportReport & { skipped: boolean };

export interface CorpusBulkImportDeps {
  db?: Queryable;
  /** Opens the dataset bucket for a source base URL; defaults to anonymous HTTPS reads. */
  openSource?: (baseUrl: string) => BulkObjectSource;
  blobs?: CorpusBlobStore | null;
}

let configuredBlobs: CorpusBlobStore | null | undefined;
let envStore: ObjectStore | undefined;

/** The deployment's object store, writing originals at `corpus/<sha256>.pdf` (ADR 0006). */
function defaultBlobs(): CorpusBlobStore {
  return {
    put: (key, body, contentType) => {
      const sha = /^corpus\/([0-9a-f]{64})\.pdf$/.exec(key)?.[1] ?? '';
      envStore ??= createObjectStoreFromEnv(serverEnv());
      return envStore.put({ key: corpusObjectKey(sha), body, contentType });
    },
  };
}

/** The object store original PDFs go to (keyed by sha256); null keeps `judgment.blob_key` empty. */
export function setCorpusBlobStore(store: CorpusBlobStore | null): void {
  configuredBlobs = store;
}

const EMPTY: CorpusBulkImportReport = {
  archives: 0,
  inserted: 0,
  duplicates: 0,
  failed: 0,
  pages: 0,
  bytes: 0,
  budgetReached: false,
  skipped: true,
};

/** The job body. Exported for tests. */
export async function runCorpusBulkImport(
  ctx: Pick<JobContext, 'log'> & { signal?: AbortSignal },
  payload: CorpusBulkImportPayload,
  deps: CorpusBulkImportDeps = {},
): Promise<CorpusBulkImportReport> {
  const db = deps.db ?? rootDb;
  const sourceId = CORPUS_BULK_SOURCES[payload.dataset];
  let baseUrl: string;
  try {
    baseUrl = (await policyFor(sourceId, { db })).baseUrl;
  } catch (error) {
    if (!(error instanceof SourceNotCleared)) throw error;
    ctx.log.warn({ sourceId, reason: error.reason }, 'corpus.bulk_import: source not cleared');
    return EMPTY;
  }
  const report = await runBulkImport(
    {
      db,
      objects: (deps.openSource ?? createS3HttpSource)(baseUrl),
      blobs: deps.blobs === undefined ? (configuredBlobs ?? defaultBlobs()) : deps.blobs,
    },
    {
      dataset: payload.dataset,
      sourceId,
      baseUrl,
      court: payload.court,
      yearFrom: payload.yearFrom,
      yearTo: payload.yearTo,
    },
    {
      maxPages: payload.maxPages ?? DEFAULT_BULK_BUDGET.maxPages,
      maxBytes: payload.maxBytes ?? DEFAULT_BULK_BUDGET.maxBytes,
    },
    ctx.signal,
  );
  ctx.log.info({ sourceId, ...report }, 'corpus.bulk_import done');
  return { ...report, skipped: false };
}

export const corpusBulkImport = defineJob({
  name: 'system.corpus.bulk-import',
  schema: corpusBulkImportSchema,
  concurrency: 1,
  singleton: {
    key: (payload) => `corpus-bulk:${payload.dataset}:${payload.court ?? 'all'}`,
    policy: 'stately',
  },
  // No schedule: started from the admin console only.
  timeoutSec: 6 * 3600,
  handler: async (ctx, payload) => {
    await runCorpusBulkImport(ctx, payload);
  },
});
