// The NCLT config v1.0.0 as committed and as registered (#38, ADR 0019): adapter.config.json is
// `NCLT_CONFIG`, migration 0049 stores exactly its canonical JSON with its checksum (the loader
// refuses a row whose checksum does not match), the access-mode rows carry the counsel note, and
// the bundled config and activation factory know the adapter.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalJson, configChecksum } from '../config/checksum.ts';
import { AdapterConfigSchema } from '../config/schema.ts';
import { createAdapterRegistry } from '../registry.ts';

import {
  createNcltAdapter,
  NCLT_ACCESS_NOTE,
  NCLT_ADAPTER_ID,
  NCLT_BUNDLED,
  NCLT_CONFIG,
  NCLT_FORUM_CODE,
} from './index.ts';

const adapterConfigJson: unknown = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'config/adapter.config.json'), 'utf8'),
);
const MIGRATION = readFileSync(
  path.resolve(import.meta.dirname, '../../../db/migrations/0049_nclt_adapter_v1.sql'),
  'utf8',
);

describe('NCLT config v1.0.0', () => {
  it('adapter.config.json is NCLT_CONFIG, with the table section and its defaults', () => {
    expect(AdapterConfigSchema.parse(adapterConfigJson)).toEqual(NCLT_CONFIG);
    expect(NCLT_CONFIG.table).toMatchObject({ minHeaderMatches: 5, columnTolerancePx: 6 });
    expect(Object.keys(NCLT_CONFIG.table?.columns ?? {})).toHaveLength(10);
    expect(NCLT_BUNDLED).toEqual({ version: '1.0.0', config: NCLT_CONFIG });
  });

  it('migration 0049 registers exactly this config, with its checksum, as 1.0.0', async () => {
    const checksum = await configChecksum(NCLT_CONFIG);
    expect(MIGRATION).toContain(`'${canonicalJson(NCLT_CONFIG)}'::jsonb`);
    expect(MIGRATION).toContain(`'${checksum}'`);
    expect(MIGRATION).toMatch(/'in\.nclt\.bengaluru',\s*'1\.0\.0',/);
  });

  it('migration 0049 records the access modes with the counsel note and raises the forum to A1', () => {
    const adapter = createNcltAdapter();
    for (const [resource, mode] of Object.entries(adapter.accessModes)) {
      expect(MIGRATION).toContain(
        `('${NCLT_ADAPTER_ID}', '${resource}', '${mode}', '${NCLT_ACCESS_NOTE}', ${String(mode !== 'none')})`,
      );
    }
    expect(NCLT_ACCESS_NOTE).toBe('NCLT T&C not yet read, counsel review pending (#118)');
    expect(MIGRATION).toMatch(/SET "adapter_level" = 'A1'[\s\S]*"code" = 'in\.nclt\.bengaluru'/);
  });

  it('registers under its dotted id and forum code', () => {
    const registry = createAdapterRegistry();
    const adapter = createNcltAdapter();
    registry.register(adapter);
    expect(registry.resolveById('in.nclt.bengaluru')).toBe(adapter);
    expect(registry.resolveByForum(NCLT_FORUM_CODE)).toBe(adapter);
  });
});
