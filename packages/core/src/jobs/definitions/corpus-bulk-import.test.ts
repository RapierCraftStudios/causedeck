import type { Queryable } from '@causedeck/db';
import { runBulkImport, type BulkObjectSource } from '@causedeck/intelligence';
import type * as Intelligence from '@causedeck/intelligence';
import { describe, expect, it, vi } from 'vitest';

// The real importer by default; a case overrides one call to return a given report.
vi.mock('@causedeck/intelligence', async (importOriginal) => {
  const actual = await importOriginal<typeof Intelligence>();
  return { ...actual, runBulkImport: vi.fn(actual.runBulkImport) };
});

import {
  corpusBulkImport,
  corpusBulkImportSchema,
  runCorpusBulkImport,
} from './corpus-bulk-import.ts';

const log = { info: vi.fn(), warn: vi.fn() } as never;

/** A `source` table with one row; `policyFor` reads it through `select().from().where().limit()`. */
const sourceDb = (row: Record<string, unknown> | undefined): Queryable =>
  ({
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }) }),
    }),
  }) as unknown as Queryable;

const clearedRow = {
  id: 'aws-open-data-sc',
  kind: 'corpus',
  baseUrl: 'https://bucket.example/',
  accessMode: 'A0',
  termsStatus: 'cleared',
  counselStatus: 'cleared',
  clearedAt: new Date('2026-10-01T00:00:00Z'),
  killSwitch: false,
  rateLimitPerMinute: 1,
  retentionDays: 30,
  residency: 'in',
  dataClass: 'mixed',
  maxTier: 'http',
  maxCostDollars: '0',
  captchaBulkCleared: false,
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

describe('system.corpus.bulk-import', () => {
  it('is off by default: no schedule, one run per dataset and court', () => {
    expect(corpusBulkImport.name).toBe('system.corpus.bulk-import');
    expect(corpusBulkImport.schedule).toBeUndefined();
    expect(corpusBulkImport.concurrency).toBe(1);
  });

  it('validates the dataset, the year range and the court', () => {
    const ok = corpusBulkImportSchema.safeParse({
      dataset: 'hc',
      court: '33_10',
      yearFrom: 2022,
      yearTo: 2023,
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { dataset: 'x' },
      { dataset: 'sc', yearFrom: 2023 },
      { dataset: 'sc', yearFrom: 2024, yearTo: 2023 },
      { dataset: 'sc', court: '33_10' },
      { dataset: 'hc', court: '../etc' },
    ]) {
      expect(corpusBulkImportSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('reads nothing while the source is uncleared or killed', async () => {
    const openSource = vi.fn();
    for (const row of [
      undefined,
      { ...clearedRow, clearedAt: null, termsStatus: 'pending' },
      { ...clearedRow, killSwitch: true },
    ]) {
      const report = await runCorpusBulkImport(
        { log },
        { dataset: 'sc' },
        { db: sourceDb(row), openSource },
      );
      expect(report).toMatchObject({ skipped: true, inserted: 0 });
    }
    expect(openSource).not.toHaveBeenCalled();
  });

  it('opens the dataset bucket at the source base URL once cleared', async () => {
    const list = vi.fn(() => Promise.resolve([] as string[]));
    const openSource = vi.fn((): BulkObjectSource => ({ list, read: vi.fn(), stream: vi.fn() }));
    const report = await runCorpusBulkImport(
      { log },
      { dataset: 'sc', yearFrom: 2023, yearTo: 2023 },
      { db: sourceDb(clearedRow), openSource },
    );
    expect(openSource).toHaveBeenCalledWith('https://bucket.example/');
    expect(list).toHaveBeenCalledWith('data/tar/year=2023/');
    expect(report).toMatchObject({ skipped: false, archives: 0 });
  });

  const finished = {
    archives: 1,
    inserted: 7,
    duplicates: 2,
    failed: 1,
    pages: 30,
    bytes: 4096,
    budgetReached: false,
  };
  const openSource = (): BulkObjectSource => ({
    list: () => Promise.resolve([]),
    read: vi.fn(),
    stream: vi.fn(),
  });

  it('hands its log to the importer and logs the final report at info (#1185)', async () => {
    const spy = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    vi.mocked(runBulkImport).mockResolvedValueOnce(finished);
    const report = await runCorpusBulkImport(
      { log: spy as never },
      { dataset: 'sc' },
      { db: sourceDb(clearedRow), openSource },
    );
    expect(report).toMatchObject({ ...finished, skipped: false });
    expect(vi.mocked(runBulkImport).mock.calls.at(-1)?.[0].log).toBe(spy);
    expect(spy.info).toHaveBeenCalledWith(
      { sourceId: 'aws-open-data-sc', ...finished },
      'corpus.bulk_import done',
    );
    expect(spy.warn).not.toHaveBeenCalled();
  });

  it('logs a warn with the reason and the report when the budget stops the run (#1185)', async () => {
    const spy = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const stopped = { ...finished, budgetReached: true };
    vi.mocked(runBulkImport).mockResolvedValueOnce(stopped);
    const report = await runCorpusBulkImport(
      { log: spy as never },
      { dataset: 'sc', maxPages: 30 },
      { db: sourceDb(clearedRow), openSource },
    );
    // A budget stop is the resume point: the job returns normally instead of failing.
    expect(report).toMatchObject({ budgetReached: true, skipped: false });
    expect(spy.warn).toHaveBeenCalledWith(
      { sourceId: 'aws-open-data-sc', reason: 'budget', ...stopped },
      'corpus.bulk_import stopped',
    );

    const aborted = new AbortController();
    aborted.abort();
    vi.mocked(runBulkImport).mockResolvedValueOnce(stopped);
    await runCorpusBulkImport(
      { log: spy as never, signal: aborted.signal },
      { dataset: 'sc' },
      { db: sourceDb(clearedRow), openSource },
    );
    expect(spy.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'aborted' }),
      'corpus.bulk_import stopped',
    );
  });

  it('queues the redact drain after each committed batch (#1197)', async () => {
    const enqueue = vi.fn<(name: string) => Promise<unknown>>(() => Promise.resolve('job-id'));
    vi.mocked(runBulkImport).mockImplementationOnce(async (deps) => {
      await deps.afterBatch?.({ inserted: 4 });
      await deps.afterBatch?.({ inserted: 3 });
      return finished;
    });
    const report = await runCorpusBulkImport(
      { log },
      { dataset: 'sc' },
      { db: sourceDb(clearedRow), openSource, enqueue },
    );
    expect(report).toMatchObject({ ...finished, skipped: false });
    expect(enqueue.mock.calls).toEqual([['system.corpus.redact'], ['system.corpus.redact']]);
  });

  it('logs a warn and completes the import when the queue is down (#1197)', async () => {
    const spy = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    vi.mocked(runBulkImport).mockImplementationOnce(async (deps) => {
      await deps.afterBatch?.({ inserted: 4 });
      return finished;
    });
    const report = await runCorpusBulkImport(
      { log: spy as never },
      { dataset: 'sc' },
      {
        db: sourceDb(clearedRow),
        openSource,
        enqueue: () => Promise.reject(new TypeError('connection refused')),
      },
    );
    expect(report).toMatchObject({ ...finished, skipped: false });
    expect(spy.warn).toHaveBeenCalledWith(
      {
        sourceId: 'aws-open-data-sc',
        inserted: 4,
        job: 'system.corpus.redact',
        error: 'TypeError',
      },
      'corpus: enqueue failed',
    );
  });

  it('fails the job when the importer throws (#1185)', async () => {
    vi.mocked(runBulkImport).mockRejectedValueOnce(new Error('stream reset'));
    await expect(
      runCorpusBulkImport({ log }, { dataset: 'sc' }, { db: sourceDb(clearedRow), openSource }),
    ).rejects.toThrow('stream reset');
  });
});
