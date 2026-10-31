// Practice-school progress (#703): idempotent marking, un-marking, closed slug list, parity with
// the site's module list, and the privacy shape of the table.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { schema } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  isLearnModuleSlug,
  LEARN_MODULE_SLUGS,
  listCompletedLearnModules,
  markLearnModuleDone,
  unmarkLearnModule,
} from './progress.ts';

describe('practice-school progress', () => {
  it('marks a module once and keeps the first completion time', async () => {
    await withTestDb(async (tx) => {
      const { ua } = await seedTwoTenants(tx);
      expect(await markLearnModuleDone(tx, { userId: ua, slug: 'using-the-os' })).toBe(true);
      const [first] = await listCompletedLearnModules(tx, { userId: ua });
      expect(await markLearnModuleDone(tx, { userId: ua, slug: 'using-the-os' })).toBe(false);
      const rows = await listCompletedLearnModules(tx, { userId: ua });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.completedAt).toEqual(first?.completedAt);
    });
  });

  it('un-marks, lists in teaching order, and un-marking a pending module is a no-op', async () => {
    await withTestDb(async (tx) => {
      const { ua } = await seedTwoTenants(tx);
      await markLearnModuleDone(tx, { userId: ua, slug: 'using-the-os' });
      await markLearnModuleDone(tx, { userId: ua, slug: 'court-day-practice' });
      expect((await listCompletedLearnModules(tx, { userId: ua })).map((e) => e.slug)).toEqual([
        'court-day-practice',
        'using-the-os',
      ]);
      expect(await unmarkLearnModule(tx, { userId: ua, slug: 'using-the-os' })).toBe(true);
      expect(await unmarkLearnModule(tx, { userId: ua, slug: 'using-the-os' })).toBe(false);
      expect(await listCompletedLearnModules(tx, { userId: ua })).toHaveLength(1);
    });
  });

  it('rejects a slug outside the closed list and a non-uuid user', async () => {
    await withTestDb(async (tx) => {
      const { ua } = await seedTwoTenants(tx);
      await expect(markLearnModuleDone(tx, { userId: ua, slug: 'made-up' })).rejects.toThrow(
        'unknown learn module',
      );
      await expect(
        markLearnModuleDone(tx, { userId: 'not-a-uuid', slug: 'using-the-os' }),
      ).rejects.toThrow();
      expect(isLearnModuleSlug('limitation-basics')).toBe(true);
      expect(isLearnModuleSlug('x; drop table')).toBe(false);
    });
  });

  it("matches the site's module list", () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../../apps/site/src/learn/slugs.ts', import.meta.url)),
      'utf8',
    );
    const block = /LEARN_SLUGS = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? '';
    const siteSlugs = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(siteSlugs).toEqual([...LEARN_MODULE_SLUGS]);
  });

  it('stores only the user id, the module slug and a timestamp', () => {
    expect(Object.keys(getTableColumns(schema.learnProgress)).sort()).toEqual([
      'completedAt',
      'id',
      'moduleSlug',
      'userId',
    ]);
  });
});
