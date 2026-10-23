// The A0 configs v1.0.0 as committed and as registered (#56): the `*.config.json` files are the
// bundled configs, migration 0062 stores exactly their canonical JSON with their checksums (the
// loader refuses a row whose checksum does not match), the access-mode rows are user_supplied for
// lists and orders and none otherwise, and the district forums stay at adapter level A0.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalJson, configChecksum } from '../../config/checksum.ts';
import { AdapterConfigSchema } from '../../config/schema.ts';
import {
  A0_ACCESS_MODES,
  A0_ADAPTER_IDS,
  A0_CONFIGS,
  A0_FORUM_CODES,
  BENGALURU_DISTRICT_FORUM_CODES,
  CHENNAI_DISTRICT_FORUM_CODES,
  createA0Adapter,
} from '../index.ts';

const MIGRATION = readFileSync(
  path.resolve(import.meta.dirname, '../../../../db/migrations/0062_generic_a0_v1.sql'),
  'utf8',
);
const SEED_DIR = path.resolve(import.meta.dirname, '../../../../db/src/seed/forum-catalogue');

describe('A0 config v1.0.0', () => {
  it.each(A0_ADAPTER_IDS)('%s: <id>.config.json is the bundled config', (id) => {
    const json: unknown = JSON.parse(
      readFileSync(path.join(import.meta.dirname, `../config/${id}.config.json`), 'utf8'),
    );
    expect(AdapterConfigSchema.parse(json)).toEqual(A0_CONFIGS[id]);
  });

  it.each(A0_ADAPTER_IDS)(
    '%s: migration 0062 registers exactly this config, with its checksum',
    async (id) => {
      const config = A0_CONFIGS[id];
      expect(config).toBeDefined();
      if (config === undefined) return;
      expect(MIGRATION).toContain(`'${canonicalJson(config).replaceAll("'", "''")}'::jsonb`);
      expect(MIGRATION).toContain(`'${await configChecksum(config)}'`);
      expect(MIGRATION).toContain(`'${id}',\n  '1.0.0',`);
    },
  );

  it('migration 0062 records the access modes of every id', () => {
    for (const id of A0_ADAPTER_IDS) {
      for (const [resource, mode] of Object.entries(createA0Adapter({ id }).accessModes)) {
        expect(MIGRATION).toContain(`('${id}', '${resource}', '${mode}', `);
        expect(MIGRATION).toContain(`'${mode}', 'A0 generic`);
      }
    }
    expect(A0_ACCESS_MODES).toEqual({
      cause_list: 'user_supplied',
      orders: 'user_supplied',
      status: 'none',
      display_board: 'none',
    });
  });

  it('migration 0062 is idempotent data and touches no schema or forum row', () => {
    expect(MIGRATION).toContain('ON CONFLICT ("adapter_id", "version") DO NOTHING');
    expect(MIGRATION).toContain('ON CONFLICT ("adapter_id", "resource") DO NOTHING');
    expect(MIGRATION).not.toMatch(/\b(CREATE|ALTER|DROP)\b/);
    expect(MIGRATION).not.toMatch(/UPDATE\s+"forum"/);
  });

  it('the forum catalogue keeps the district forums at adapter level A0 under these ids', () => {
    for (const [file, id, codes] of [
      ['bengaluru-district.ts', 'in.ka.bengaluru-urban.district', BENGALURU_DISTRICT_FORUM_CODES],
      ['chennai-district.ts', 'in.tn.chennai.district', CHENNAI_DISTRICT_FORUM_CODES],
    ] as const) {
      const source = readFileSync(path.join(SEED_DIR, file), 'utf8');
      expect(source).toContain(`adapterId: '${id}'`);
      expect(source).toContain("adapterLevel: 'A0'");
      for (const code of codes) expect(source).toContain(`code: '${code}'`);
      expect(A0_FORUM_CODES[id]).toEqual(codes);
    }
  });

  it('declares no deep link: the district cause-list pages are never opened by the product', () => {
    for (const id of A0_ADAPTER_IDS) expect(createA0Adapter({ id }).links).toEqual({});
  });
});
