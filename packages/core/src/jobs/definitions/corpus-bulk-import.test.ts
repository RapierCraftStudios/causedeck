import type { Queryable } from '@causedeck/db';
import type { BulkObjectSource } from '@causedeck/intelligence';
import { describe, expect, it, vi } from 'vitest';

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
});
