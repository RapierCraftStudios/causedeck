import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../migrate.ts';
import { createOwnerDb } from '../owner.ts';
import { schemaInfo } from '../schema/index.ts';
import {
  closeTestDb,
  createScratchDatabase,
  testDatabaseUrls,
  truncateAll,
  withTestDb,
} from '../testing/index.ts';

afterAll(closeTestDb);

describe('Testcontainers harness', () => {
  it('runs Postgres 17 with the vector extension', async () => {
    await withTestDb(async (tx) => {
      const [version] = await tx.execute<{ server_version: string }>(sql`show server_version`);
      expect(version?.server_version).toMatch(/^17\./);
      const [row] = await tx.execute<{ v: string }>(sql`select '[1,2,3]'::vector::text as v`);
      expect(row?.v).toBe('[1,2,3]');
    });
  });

  it('connects tests as the app role, with the baseline migrated', async () => {
    await withTestDb(async (tx) => {
      const [who] = await tx.execute<{ u: string }>(sql`select current_user as u`);
      expect(who?.u).toBe('causedeck_app');
      const rows = await tx.select().from(schemaInfo);
      expect(rows.map((r) => r.baselineVersion)).toEqual(['0000_baseline']);
    });
  });

  it('rolls every withTestDb transaction back, so tests never see each other', async () => {
    await withTestDb(async (tx) => {
      await tx.delete(schemaInfo);
      expect(await tx.select().from(schemaInfo)).toHaveLength(0);
    });
    await withTestDb(async (tx) => {
      expect(await tx.select().from(schemaInfo)).toHaveLength(1);
    });
  });

  it('returns the callback value and rethrows callback errors', async () => {
    await expect(withTestDb(() => Promise.resolve(42))).resolves.toBe(42);
    await expect(withTestDb(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('truncateAll keeps the schema_info baseline row', async () => {
    // A scratch database: truncating the shared one would wipe rows other files have committed.
    const scratch = await createScratchDatabase(testDatabaseUrls(), 'harness_truncate');
    try {
      await runMigrations({ url: new Secret(scratch.owner) });
      await truncateAll(scratch.owner);
      const owner = createOwnerDb(new Secret(scratch.owner));
      try {
        expect(await owner.select().from(schemaInfo)).toHaveLength(1);
      } finally {
        await owner.$client.end();
      }
    } finally {
      await scratch.drop();
    }
  });
});
