// Purge completeness (#302): every tenant table in the cross-tenant registry (`TABLE_TESTS`) is
// either purged in step 4 (`PURGE_ORDER`) or removed by the final step (`FINALIZE_TABLES`), so the
// "zero rows for the workspace" guarantee holds for tables later milestones add.
import { TABLE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { describe, expect, it } from 'vitest';

import { FINALIZE_TABLES, PURGE_ORDER, purgeCoverage } from '../index.ts';

const tenantTables = Object.keys(TABLE_TESTS);

describe('purge coverage', () => {
  it('purges or finalizes every tenant table, each exactly once', () => {
    expect(purgeCoverage(tenantTables), 'add the table to PURGE_ORDER or FINALIZE_TABLES').toEqual({
      uncovered: [],
      conflicting: [],
      stale: [],
    });
    expect(new Set(PURGE_ORDER).size).toBe(PURGE_ORDER.length);
  });

  it('deletes invoice lines before invoices and members last', () => {
    expect(PURGE_ORDER.indexOf('saas_invoice_line')).toBeLessThan(
      PURGE_ORDER.indexOf('saas_invoice'),
    );
    expect(PURGE_ORDER.at(-1)).toBe('member');
    for (const [table, reason] of Object.entries(FINALIZE_TABLES)) {
      expect(reason.length, table).toBeGreaterThan(20);
    }
  });

  it('reports a new tenant table that nothing purges', () => {
    expect(purgeCoverage([...tenantTables, 'matter']).uncovered).toEqual(['matter']);
    expect(purgeCoverage(tenantTables.filter((t) => t !== 'blob')).stale).toEqual(['blob']);
  });
});
