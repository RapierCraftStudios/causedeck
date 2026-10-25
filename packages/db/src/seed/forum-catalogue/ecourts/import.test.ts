// Seeding imported eCourts establishments (#635): at A0, idempotent on re-import (also across more
// rows than one insert chunk), workspace forums untouched.
import { Secret } from '@causedeck/config/env';
import { and, inArray, isNotNull, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../../../client.ts';
import { createOwnerDb } from '../../../owner.ts';
import { forum } from '../../../schema/court.ts';
import { testDatabaseUrls } from '../../../testing/index.ts';
import { FORUM_CATALOGUE, parseForumCatalogue, seedForumCatalogue } from '../index.ts';

import { snapshotToForumSeeds } from './snapshot.ts';

// Fictional establishments: not real courts, not portal data.
const FICTIONAL = {
  source: 'fictional test fixture',
  licence: 'none (test data)',
  retrievedOn: '2026-10-24',
  establishments: [
    { code: 'TST01', state: 'tn', district: 'Testpur', establishment: 'Fictional District Court' },
    { code: 'TST02', state: 'tn', district: 'Testpur', establishment: 'Fictional Family Court' },
    { code: 'TST03', state: 'ka', district: 'Imaginary Nagar', establishment: 'Sample Court' },
  ],
};

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
afterAll(async () => {
  await owner.$client.end();
});

async function rolledBack(fn: (tx: Transaction) => Promise<void>) {
  try {
    await owner.transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

describe('seeding imported establishments (#635)', () => {
  it('adds them at A0, re-importing changes nothing, workspace forums are untouched', async () => {
    const imported = snapshotToForumSeeds(FICTIONAL);
    // More rows than one insert chunk, to cover chunking.
    const many = snapshotToForumSeeds({
      ...FICTIONAL,
      establishments: Array.from({ length: 4500 }, (_, i) => ({
        code: `BULK${String(i)}`,
        state: 'tn',
        district: 'Testpur',
        establishment: `Bulk Court ${String(i)}`,
      })),
    });
    const catalogue = parseForumCatalogue([...FORUM_CATALOGUE, ...imported, ...many]);
    await rolledBack(async (tx) => {
      const first = await seedForumCatalogue(tx, { catalogue });
      expect(first.inserted).toBeGreaterThanOrEqual(imported.length + many.length);
      const rows = await tx
        .select({ code: forum.code, level: forum.adapterLevel })
        .from(forum)
        .where(
          inArray(
            forum.code,
            imported.map((s) => s.code),
          ),
        );
      expect(rows).toHaveLength(imported.length);
      expect(rows.every((r) => r.level === 'A0')).toBe(true);
      const workspaceBefore = await tx.$count(forum, and(isNotNull(forum.workspaceId)));
      const again = await seedForumCatalogue(tx, { catalogue });
      expect(again).toMatchObject({ inserted: 0, updated: 0, disabled: 0 });
      expect(again.unchanged).toBe(catalogue.length);
      expect(await tx.$count(forum, and(isNotNull(forum.workspaceId)))).toBe(workspaceBefore);
    });
  });
});
