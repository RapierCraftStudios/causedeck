// The Karnataka HC `adapter_version` rows: 1.0.0 (#404, migration 0049) retired by 1.1.0 (#405,
// migration 0051), which is active, accepted by the DB checks, and equal to the bundled config with
// a valid checksum, so the loader serves it.
import { adapterVersion } from '@causedeck/db/schema';
import { withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { configChecksum } from '../config/checksum.ts';
import { createAdapterConfigLoader, verifyStoredConfig } from '../config/loader.ts';

import { KARNATAKA_HC_ADAPTER_ID, KARNATAKA_HC_CONFIG } from './index.ts';

describe('Karnataka HC adapter_version 1.1.0 (#404, #405)', () => {
  it('is active after the migrations, with the bundled config and its checksum', async () => {
    await withTestDb(async (tx) => {
      const rows = await tx
        .select()
        .from(adapterVersion)
        .where(eq(adapterVersion.adapterId, KARNATAKA_HC_ADAPTER_ID));
      expect(rows.map((r) => [r.version, r.status]).sort()).toEqual([
        ['1.0.0', 'retired'],
        ['1.1.0', 'active'],
      ]);
      const row = rows.find((r) => r.version === '1.1.0');
      expect(row).toMatchObject({ status: 'active', fixturesDigest: null });
      expect(row?.activatedAt).toBeInstanceOf(Date);
      if (row === undefined) return;
      const stored = await verifyStoredConfig(KARNATAKA_HC_ADAPTER_ID, row);
      expect(stored.config).toEqual(KARNATAKA_HC_CONFIG);
      expect(row.checksum).toBe(await configChecksum(KARNATAKA_HC_CONFIG));
      const loaded = await createAdapterConfigLoader({ db: tx }).load(KARNATAKA_HC_ADAPTER_ID);
      expect(loaded).toMatchObject({ source: 'db', version: '1.1.0' });
    });
  });

  it('is accepted by the adapter-id check when inserted again under a new version', async () => {
    await withTestDb(async (tx) => {
      await tx.insert(adapterVersion).values({
        adapterId: KARNATAKA_HC_ADAPTER_ID,
        version: '1.1.1',
        config: {},
        checksum: 'b'.repeat(64),
      });
      const [draft] = await tx
        .select({ status: adapterVersion.status })
        .from(adapterVersion)
        .where(
          and(
            eq(adapterVersion.adapterId, KARNATAKA_HC_ADAPTER_ID),
            eq(adapterVersion.version, '1.1.1'),
          ),
        );
      expect(draft).toEqual({ status: 'draft' });
    });
  });
});
