import { Secret } from '@causedeck/config/env';
import { afterEach, describe, expect, it } from 'vitest';

import { createDb } from '../../client.ts';
import { runMigrations } from '../../migrate.ts';
import { createScratchDatabase, testDatabaseUrls } from '../../testing/index.ts';
import {
  E2E_DELETED_WORKSPACE,
  E2E_EXTRA_MEMBERSHIPS,
  E2E_INVITATIONS,
  E2E_USERS,
  E2E_WORKSPACE_SLUGS,
  E2E_WORKSPACES,
  e2eInvitationTokenHash,
  e2eUser,
} from '../e2e.ts';
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
    for (const table of ['organization', 'user', 'member', 'invitation']) {
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

  it('puts the chennai-solo owner in two live workspaces and one soft-deleted one (#179)', async () => {
    const dump = await seedAndDump('e2e_seed_memberships');
    const owner = e2eUser('owner', 'chennai-solo');
    const members = (dump.member ?? '')
      .split('\n')
      .map((row) => JSON.parse(row) as { workspace_id: string; user_id: string; role: string })
      .filter((m) => m.user_id === owner.id)
      .map((m) => [m.workspace_id, m.role])
      .sort();
    expect(members).toEqual(
      [
        [E2E_WORKSPACES['chennai-solo'].id, 'owner'],
        [E2E_WORKSPACES['bengaluru-chamber'].id, 'clerk'],
        [E2E_DELETED_WORKSPACE.id, 'owner'],
      ].sort(),
    );
    expect(E2E_EXTRA_MEMBERSHIPS.map((m) => m.workspace)).toEqual(['bengaluru-chamber']);
    const deleted = (dump.organization ?? '')
      .split('\n')
      .map((row) => JSON.parse(row) as { id: string; slug: string; deleted_at: string | null })
      .find((w) => w.id === E2E_DELETED_WORKSPACE.id);
    expect(deleted?.slug).toBe('mysuru-archived');
    expect(deleted?.deleted_at).not.toBeNull();
    // E2E_USERS (one storage state each in global-setup) is unchanged: 2 workspaces x 5 roles.
    expect(E2E_USERS).toHaveLength(10);
  });

  it('seeds one hashed invitation per /invite state for a non-member (#180)', async () => {
    const dump = await seedAndDump('e2e_seed_invites');
    const rows = (dump.invitation ?? '')
      .split('\n')
      .map((row) => JSON.parse(row) as Record<string, string | null>);
    expect(rows).toHaveLength(4);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const workspaceId = E2E_WORKSPACES['chennai-solo'].id;
    const invitee = Object.values(E2E_INVITATIONS)[0]?.email;
    expect(E2E_USERS.some((u) => u.email === invitee && u.workspace === 'chennai-solo')).toBe(
      false,
    );
    for (const seeded of Object.values(E2E_INVITATIONS)) {
      const row = byId.get(seeded.id);
      expect(row?.token_hash).toBe(e2eInvitationTokenHash(seeded.token));
      expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(seeded.token);
      expect(row?.workspace_id).toBe(workspaceId);
      expect(row?.email).toBe(invitee);
    }
    const state = (id: string) => byId.get(id);
    expect(state(E2E_INVITATIONS.valid.id)).toMatchObject({
      accepted_at: null,
      revoked_at: null,
      status: 'pending',
    });
    expect(Date.parse(state(E2E_INVITATIONS.valid.id)?.expires_at ?? '')).toBeGreaterThan(
      Date.parse('2090-01-01'),
    );
    expect(Date.parse(state(E2E_INVITATIONS.expired.id)?.expires_at ?? '')).toBeLessThan(
      Date.now(),
    );
    expect(state(E2E_INVITATIONS.revoked.id)?.revoked_at).not.toBeNull();
    expect(state(E2E_INVITATIONS.used.id)?.accepted_at).not.toBeNull();
  });
});
