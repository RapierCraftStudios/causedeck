// The Madras HC adapter's first version (#401, migration 0047, ADR 0018): the migrated
// `adapter_version` row is the one active version, `1.0.0`, with the bundled config's checksum, so
// the loader serves it from the database instead of refusing it. A bundled-config change without a
// new version fails here.
import { adapterVersion } from '@causedeck/db/schema';
import { withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { configChecksum } from '../index.ts';
import { createAdapterConfigLoader } from '../server.ts';

import { MADRAS_HC_ADAPTER_ID, MADRAS_HC_CONFIG, MADRAS_HC_VERSION } from './index.ts';

describe('Madras HC adapter_version 1.0.0 (migration 0047)', () => {
  it('is the single active version, with the bundled config checksum', async () => {
    await withTestDb(async (tx) => {
      const active = await tx
        .select()
        .from(adapterVersion)
        .where(
          and(
            eq(adapterVersion.adapterId, MADRAS_HC_ADAPTER_ID),
            eq(adapterVersion.status, 'active'),
          ),
        );
      expect(active).toHaveLength(1);
      const [row] = active;
      expect(row?.version).toBe(MADRAS_HC_VERSION);
      expect(row?.version).toBe('1.0.0');
      expect(row?.checksum).toBe(await configChecksum(MADRAS_HC_CONFIG));
      expect(row?.activatedAt).toBeInstanceOf(Date);
      expect(row?.fixturesDigest).toBeNull();
    });
  });

  it('is served by the loader from the database', async () => {
    await withTestDb(async (tx) => {
      const loaded = await createAdapterConfigLoader({ db: tx }).load(MADRAS_HC_ADAPTER_ID);
      expect(loaded).toMatchObject({
        source: 'db',
        version: '1.0.0',
        checksum: await configChecksum(MADRAS_HC_CONFIG),
      });
    });
  });
});
