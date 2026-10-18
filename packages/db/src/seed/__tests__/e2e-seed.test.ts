import { Secret } from '@causedeck/config/env';
import { afterEach, describe, expect, it } from 'vitest';

import { createDb } from '../../client.ts';
import { runMigrations } from '../../migrate.ts';
import { createScratchDatabase, testDatabaseUrls } from '../../testing/index.ts';
import { E2E_USERS, E2E_WORKSPACE_SLUGS, E2E_WORKSPACES } from '../e2e.ts';
import { registeredSeeds, seed } from '../index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Migrate a fresh database, seed the `e2e` profile and dump the seeded tables as text. */
async function seedAndDump(name: string, times = 1): Promise<Record<string, string>> {
  const scratch = await createScratchDatabase(testDatabaseUrls(), name);
  cleanups.push(scratch.drop);
  await runMigrations({ url: new Secret(scratch.owner) });
  const db = createDb({ url: new Secret(scratch.app), role: 'app', max: 1 });
  try {
    for (let i = 0; i < times; i++) await seed(db, { profile: 'e2e' });
    const dump: Record<string, string> = {};
    for (const table of ['organization', 'user', 'member']) {
      const rows = await db.$client.unsafe<{ row: string }[]>(
        `select row_to_json(t)::text as row from "${table}" t order by id`,
      );
      dump[table] = rows.map((r) => r.row).join('\n');
    }
    return dump;
  } finally {
    await db.$client.end();
  }
}

describe('e2e seed profile', () => {
  it('registers only for the e2e profile', () => {
    expect(registeredSeeds('e2e').map((s) => s.name)).toContain('e2e-workspaces');
    expect(registeredSeeds('demo').map((s) => s.name)).not.toContain('e2e-workspaces');
    expect(registeredSeeds('test').map((s) => s.name)).not.toContain('e2e-workspaces');
  });

  it('produces byte-identical rows (ids, timestamps) on two consecutive seeds', async () => {
    const first = await seedAndDump('e2e_seed_a');
    const second = await seedAndDump('e2e_seed_b', 2);
    expect(first.organization).not.toBe('');
    expect(second).toEqual(first);
    expect(first.user).toContain('"created_at":"2026-02-28T18:30:00+00:00"');
  });

  it('seeds two workspaces with one member per role, fictional parties only', () => {
    expect(Object.keys(E2E_WORKSPACES).sort()).toEqual(['bengaluru-chamber', 'chennai-solo']);
    for (const slug of E2E_WORKSPACE_SLUGS) {
      const roles = E2E_USERS.filter((u) => u.workspace === slug).map((u) => u.role);
      expect(roles.sort()).toEqual(['advocate', 'clerk', 'junior', 'owner', 'viewer']);
    }
    for (const u of E2E_USERS) expect(u.email).toMatch(/^[a-z]+@[a-z-]+\.e2e\.test$/);
    expect(new Set(E2E_USERS.map((u) => u.id)).size).toBe(E2E_USERS.length);
  });
});
