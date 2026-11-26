// `system.corpus.hf-import` (#1171, D-053): imports the extracted texts of the Hugging Face dataset
// `overthelex/indian-court-decisions` (CC-BY-4.0, from Dattam Labs) into the global `judgment` corpus
// as text-only rows waiting for their PDF. Off by default: no schedule, started from the admin console
// per config, court and year range. The source must be cleared (`policyFor` throws before any read,
// also when killed), a run is bounded by a row and a byte budget, and the importer resumes from the
// per-file cursor, so a re-run only picks up what is left. Only ids, counts and keys are logged.
import { db as rootDb, type Queryable } from '@causedeck/db';
import {
  createHfHttpSource,
  DEFAULT_HF_BUDGET,
  drizzleHfImportStore,
  HF_SOURCE_ID,
  runHfImport,
  type HfDatasetSource,
  type HfImportReport,
} from '@causedeck/intelligence';
import { z } from 'zod';

import { policyFor, SourceNotCleared } from '../../sources/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

const year = z.number().int().min(1947).max(2100);

export const corpusHfImportSchema = z
  .object({
    workspaceId: z.null().optional(),
    /** `sc` the Supreme Court config, `hc` the High Courts config. */
    dataset: z.enum(['sc', 'hc']),
    /** The dataset's `court_code`, e.g. `KAHC`. */
    court: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,40}$/)
      .optional(),
    yearFrom: year.optional(),
    yearTo: year.optional(),
    maxRows: z.number().int().min(1).max(1_000_000).optional(),
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 ** 3)
      .optional(),
  })
  .refine((p) => p.yearFrom === undefined || p.yearTo === undefined || p.yearFrom <= p.yearTo, {
    message: 'yearFrom is after yearTo',
  });

export type CorpusHfImportPayload = z.infer<typeof corpusHfImportSchema>;

export type CorpusHfImportReport = HfImportReport & { skipped: boolean };

export interface CorpusHfImportDeps {
  db?: Queryable;
  /** Opens the dataset for the source base URL; defaults to anonymous pinned HTTPS reads. */
  openSource?: (baseUrl: string) => HfDatasetSource;
}

const skipped = (): CorpusHfImportReport => ({
  files: 0,
  rows: 0,
  inserted: 0,
  duplicates: 0,
  aliases: 0,
  dropped: { empty: 0, short: 0, repeated: 0, garbled: 0 },
  failed: 0,
  bytes: 0,
  budgetReached: false,
  skipped: true,
});

/** The job body. Exported for tests. */
export async function runCorpusHfImport(
  ctx: Pick<JobContext, 'log'> & { signal?: AbortSignal },
  payload: CorpusHfImportPayload,
  deps: CorpusHfImportDeps = {},
): Promise<CorpusHfImportReport> {
  const db = deps.db ?? rootDb;
  let baseUrl: string;
  try {
    baseUrl = (await policyFor(HF_SOURCE_ID, { db })).baseUrl;
  } catch (error) {
    if (!(error instanceof SourceNotCleared)) throw error;
    ctx.log.warn(
      { sourceId: HF_SOURCE_ID, reason: error.reason },
      'corpus.hf_import: source not cleared',
    );
    return skipped();
  }
  const report = await runHfImport(
    {
      store: drizzleHfImportStore(db),
      source: (deps.openSource ?? ((url) => createHfHttpSource(url)))(baseUrl),
    },
    {
      dataset: payload.dataset,
      baseUrl,
      court: payload.court,
      yearFrom: payload.yearFrom,
      yearTo: payload.yearTo,
    },
    {
      maxRows: payload.maxRows ?? DEFAULT_HF_BUDGET.maxRows,
      maxBytes: payload.maxBytes ?? DEFAULT_HF_BUDGET.maxBytes,
    },
    ctx.signal,
  );
  ctx.log.info({ sourceId: HF_SOURCE_ID, ...report }, 'corpus.hf_import done');
  return { ...report, skipped: false };
}

export const corpusHfImport = defineJob({
  name: 'system.corpus.hf-import',
  schema: corpusHfImportSchema,
  concurrency: 1,
  // One run at a time over the whole dataset: dedupe reads the text hashes other runs write.
  singleton: { key: () => 'corpus-hf', policy: 'stately' },
  // No schedule: started from the admin console only.
  timeoutSec: 6 * 3600,
  handler: async (ctx, payload) => {
    await runCorpusHfImport(ctx, payload);
  },
});
