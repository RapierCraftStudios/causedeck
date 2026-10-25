// Export completeness (#301, `pnpm test:export-coverage`): every tenant table in the cross-tenant
// registry (`TABLE_TESTS`, #19; itself checked against the live catalog by `pnpm test:tenancy`)
// has exactly one registered exporter or a documented exclusion. A new tenant table without
// either fails CI here.
import { TABLE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { describe, expect, it } from 'vitest';

import '../export/exporters.ts';
import {
  EXPORT_EXCLUSIONS,
  exportCoverage,
  registeredExporters,
  type Exporter,
} from '../export/registry.ts';

const tenantTables = Object.keys(TABLE_TESTS);

describe('export coverage', () => {
  it('covers every tenant table with an exporter or a documented exclusion', () => {
    const coverage = exportCoverage(tenantTables);
    expect(
      coverage.uncovered,
      'tenant tables with no exporter: register one, or add a reasoned EXPORT_EXCLUSIONS entry',
    ).toEqual([]);
    expect(coverage.conflicting, 'tables both exported and excluded').toEqual([]);
    expect(coverage.stale, 'exporters or exclusions for tables that no longer exist').toEqual([]);
  });

  it('gives every exclusion a written reason', () => {
    for (const [table, reason] of Object.entries(EXPORT_EXCLUSIONS)) {
      expect(reason.trim().length, table).toBeGreaterThan(20);
    }
  });

  it('assigns each table to one exporter only', () => {
    const tables = registeredExporters().flatMap((e) => e.tables);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('reports a new tenant table that has no exporter', () => {
    expect(exportCoverage([...tenantTables, 'xt_new_table']).uncovered).toEqual(['xt_new_table']);
  });

  it('does not count an exclusion without a reason', () => {
    const exporters: Exporter[] = [];
    expect(exportCoverage(['a'], exporters, { a: '  ' }).uncovered).toEqual(['a']);
  });

  it('reports stale exporters and tables both exported and excluded', () => {
    const exporter: Exporter = {
      name: 'x',
      tables: ['a', 'gone'],
      collect: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: true, value: undefined }),
        }),
      }),
    };
    expect(exportCoverage(['a'], [exporter], { a: 'reason enough for a test' })).toEqual({
      uncovered: [],
      conflicting: ['a'],
      stale: ['gone'],
    });
  });
});
