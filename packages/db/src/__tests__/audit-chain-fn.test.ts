// The audit chain function (#226, #26): `app_audit_append()` serialises writers of one workspace
// chain with an advisory lock, so concurrent appends form one linear chain where each
// hash = sha256(prev_hash || app_audit_canonical(event)::text).
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb, type Transaction } from '../client.ts';
import { createOwnerDb } from '../owner.ts';
import { withUser, withWorkspace } from '../rls.ts';
import { inWorkspace, testDatabaseUrls, withTestDb } from '../testing/index.ts';
import { newUser, sqlState } from './rls/fixtures.ts';

const CONCURRENT = 24;
const committedWorkspace = randomUUID();

const app = createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 12 });

afterAll(async () => {
  // The rows of the concurrency test were committed; remove them through the retention switch.
  const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
  try {
    await owner.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.audit_retention', 'on', true)`);
      await withWorkspace(tx, { workspaceId: committedWorkspace }, (scoped) =>
        scoped.execute(sql`delete from audit_event where workspace_id = ${committedWorkspace}`),
      );
    });
  } finally {
    await owner.$client.end();
    await app.$client.end();
  }
});

type ChainRow = { prev: string | null; hash: string; valid: boolean };

/** The chain of the pinned workspace (or the account chain), in append order. */
async function chain(tx: Transaction, workspace: string | null): Promise<ChainRow[]> {
  return tx.execute<ChainRow>(sql`
    select encode(prev_hash, 'hex') as prev, encode(hash, 'hex') as hash,
           hash = sha256(coalesce(prev_hash, ''::bytea)
                         || convert_to(app_audit_canonical(a)::text, 'UTF8')) as valid
    from audit_event a
    where workspace_id is not distinct from ${workspace}::uuid
    order by created_at, id`);
}

function expectLinear(rows: ChainRow[], length: number): void {
  expect(rows).toHaveLength(length);
  expect(rows.filter((r) => r.prev === null)).toHaveLength(1);
  rows.forEach((row, i) => {
    expect(row.valid, `row ${String(i)} hash`).toBe(true);
    expect(row.prev, `row ${String(i)} prev_hash`).toBe(i === 0 ? null : rows[i - 1]?.hash);
  });
  expect(new Set(rows.map((r) => r.prev)).size).toBe(length);
}

const append = (tx: Transaction, workspaceId: string | null, action: string, actor?: string) =>
  tx.execute<{ id: string; hash: string }>(sql`
    select id, encode(hash, 'hex') as hash
    from app_audit_append(${workspaceId}::uuid, ${actor ?? null}::uuid, 'user', ${action},
                          'member', 'm-1', 'success', '203.0.113.7'::inet, 'ua-hash', 'req-1',
                          '{"role":"clerk"}'::jsonb)`);

describe('app_audit_append', () => {
  it('serialises concurrent appends in one workspace into a linear chain', async () => {
    await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        app.transaction((tx) =>
          withWorkspace(tx, { workspaceId: committedWorkspace }, (scoped) =>
            append(scoped, committedWorkspace, `test.concurrent.${String(i)}`),
          ),
        ),
      ),
    );
    await app.transaction((tx) =>
      withWorkspace(tx, { workspaceId: committedWorkspace }, async (scoped) => {
        expectLinear(await chain(scoped, committedWorkspace), CONCURRENT);
      }),
    );
  });

  it('starts a separate chain per workspace with a null genesis prev_hash', async () => {
    await withTestDb(async (tx) => {
      for (const workspaceId of [randomUUID(), randomUUID()]) {
        await inWorkspace(tx, workspaceId, async (scoped) => {
          for (let i = 0; i < 3; i += 1) await append(scoped, workspaceId, `test.seq.${String(i)}`);
          expectLinear(await chain(scoped, workspaceId), 3);
        });
      }
    });
  });

  it('keeps an account chain for null-workspace events, readable only by their actor', async () => {
    await withTestDb(async (tx) => {
      const actor = await newUser(tx);
      const other = await newUser(tx);
      const [row] = await withUser(tx, { userId: actor }, (scoped) =>
        append(scoped, null, 'auth.sign_in', actor),
      );
      expect(row?.hash).toMatch(/^[0-9a-f]{64}$/);
      const mine = await withUser(tx, { userId: actor }, (scoped) =>
        scoped.execute(sql`select id from audit_event where workspace_id is null`),
      );
      expect(mine.map((r) => r['id'])).toEqual([row?.id]);
      const theirs = await withUser(tx, { userId: other }, (scoped) =>
        scoped.execute(sql`select id from audit_event where workspace_id is null`),
      );
      expect(theirs).toEqual([]);
      // A workspace scope never sees account-level events.
      await inWorkspace(
        tx,
        randomUUID(),
        async (scoped) => {
          const seen = await scoped.execute(
            sql`select id from audit_event where workspace_id is null`,
          );
          expect(seen).toEqual([]);
        },
        actor,
      );
    });
  });

  it('refuses to append for a workspace other than the pinned one', async () => {
    await withTestDb(async (tx) => {
      await inWorkspace(tx, randomUUID(), async (scoped) => {
        const otherWorkspace = randomUUID();
        expect(
          await sqlState(scoped.transaction((sp) => append(sp, otherWorkspace, 'test.cross'))),
        ).toBe('42501');
      });
      await withUser(tx, { userId: await newUser(tx) }, async (scoped) => {
        expect(
          await sqlState(scoped.transaction((sp) => append(sp, randomUUID(), 'test.unpinned'))),
        ).toBe('42501');
      });
    });
  });

  it('rejects a forked event that reuses a prev_hash', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await inWorkspace(tx, workspaceId, async (scoped) => {
        await append(scoped, workspaceId, 'test.first');
        await append(scoped, workspaceId, 'test.second');
        const fork = scoped.transaction((sp) =>
          sp.execute(sql`
            insert into audit_event (workspace_id, actor_kind, action, prev_hash, hash)
            select workspace_id, 'user', 'test.fork', prev_hash, '\\x01'::bytea
            from audit_event where workspace_id = ${workspaceId} and prev_hash is not null`),
        );
        expect(await sqlState(fork)).toBe('23505');
      });
    });
  });

  it('issues time-ordered version 7 ids', async () => {
    await withTestDb(async (tx) => {
      const [row] = await tx.execute<{ a: string; b: string }>(
        sql`select app_uuid_v7()::text as a, app_uuid_v7()::text as b`,
      );
      if (row === undefined) throw new Error('no row');
      expect(row.a).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      // The leading 48 bits are the millisecond timestamp.
      expect(row.a.slice(0, 13) <= row.b.slice(0, 13)).toBe(true);
    });
  });
});
