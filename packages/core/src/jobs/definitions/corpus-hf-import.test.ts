import type { Queryable } from '@causedeck/db';
import type { HfDatasetSource } from '@causedeck/intelligence';
import { describe, expect, it, vi } from 'vitest';

import { corpusHfImport, corpusHfImportSchema, runCorpusHfImport } from './corpus-hf-import.ts';

const log = { info: vi.fn(), warn: vi.fn() } as never;

/** A `source` table with one row; `policyFor` reads it through `select().from().where().limit()`. */
const sourceDb = (row: Record<string, unknown> | undefined): Queryable =>
  ({
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }) }),
    }),
  }) as unknown as Queryable;

const BASE = 'https://huggingface.co/datasets/overthelex/indian-court-decisions/';

const clearedRow = {
  id: 'hf-overthelex',
  kind: 'corpus',
  baseUrl: BASE,
  accessMode: 'A0',
  termsStatus: 'cleared',
  counselStatus: 'cleared',
  clearedAt: new Date('2026-11-01T00:00:00Z'),
  killSwitch: false,
  rateLimitPerMinute: 1,
  retentionDays: 30,
  residency: 'in',
  dataClass: 'mixed',
  maxTier: 'http',
  maxCostDollars: '0',
  captchaBulkCleared: false,
  updatedAt: new Date('2026-11-01T00:00:00Z'),
};

describe('system.corpus.hf-import', () => {
  it('is off by default: no schedule, one run at a time', () => {
    expect(corpusHfImport.name).toBe('system.corpus.hf-import');
    expect(corpusHfImport.schedule).toBeUndefined();
    expect(corpusHfImport.concurrency).toBe(1);
  });

  it('validates the config, the court code, the years and the budget', () => {
    expect(
      corpusHfImportSchema.safeParse({
        dataset: 'hc',
        court: 'KAHC',
        yearFrom: 2020,
        yearTo: 2021,
        maxRows: 500,
        maxBytes: 100 * 1024 ** 2,
      }).success,
    ).toBe(true);
    for (const bad of [
      { dataset: 'hf' },
      { dataset: 'hc', court: '../etc' },
      { dataset: 'hc', yearFrom: 2022, yearTo: 2021 },
      { dataset: 'sc', maxRows: 0 },
      { dataset: 'sc', maxBytes: 20 * 1024 ** 3 },
    ]) {
      expect(corpusHfImportSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('reads nothing while the source is missing, uncleared or killed', async () => {
    const openSource = vi.fn();
    for (const row of [
      undefined,
      { ...clearedRow, clearedAt: null, termsStatus: 'pending' },
      { ...clearedRow, killSwitch: true },
    ]) {
      const report = await runCorpusHfImport(
        { log },
        { dataset: 'hc' },
        { db: sourceDb(row), openSource },
      );
      expect(report).toMatchObject({ skipped: true, inserted: 0, files: 0 });
    }
    expect(openSource).not.toHaveBeenCalled();
  });

  it('opens the dataset at the source base URL once cleared and reports counts', async () => {
    const list = vi.fn(() => Promise.resolve([]));
    const openSource = vi.fn(
      (): HfDatasetSource => ({ list, open: vi.fn(), bytesRead: () => 0 }),
    );
    const report = await runCorpusHfImport(
      { log },
      { dataset: 'sc', yearFrom: 2020, yearTo: 2020 },
      { db: sourceDb(clearedRow), openSource },
    );
    expect(openSource).toHaveBeenCalledWith(BASE);
    expect(list).toHaveBeenCalledWith('supreme_court');
    expect(report).toMatchObject({
      skipped: false,
      files: 0,
      inserted: 0,
      duplicates: 0,
      aliases: 0,
      dropped: { empty: 0, short: 0, repeated: 0, garbled: 0 },
    });
  });
});
