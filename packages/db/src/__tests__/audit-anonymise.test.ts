// Chain-safe audit anonymisation (#303, migration 0031). `app_audit_append` stores a salted
// `actor_ref` and the chain hashes it instead of `actor_user_id`, so `app_audit_anonymise_actor`
// can null the id of a deleted user without breaking the chain; it refuses while the user exists,
// and the salt table is owner-only. The verifiers report an altered `actor_user_id` as `actor`.
// The one-time re-chain of 0031 gives legacy rows an `actor_ref` and keeps every chain valid, and
// refuses to run over a chain that was already broken.
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createDb, type Database, type Transaction } from '../client.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../migrate.ts';
import { createOwnerDb } from '../owner.ts';
import { withUser, withWorkspace } from '../rls.ts';
import { organization, user } from '../schema/auth.ts';
import { createScratchDatabase, testDatabaseUrls, withTestDb } from '../testing/index.ts';
import { newUser, sqlState } from './rls/fixtures.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
afterAll(async () => {
  await owner.$client.end();
});

type Queryable = Database | Transaction;

const append = (tx: Queryable, workspaceId: string | null, actor: string | null, action: string) =>
  tx.execute<{ id: string }>(sql`
    select id from app_audit_append(${workspaceId}::uuid, ${actor}::uuid,
      ${actor === null ? 'system' : 'user'}::audit_actor_kind, ${action}, null, null, 'success',
      null, null, null, '{}'::jsonb)`);

/** Hash and link checks of one chain (the oldest row's prev_hash is taken as given). */
async function chainOk(tx: Queryable, workspaceId: string | null, from?: Date): Promise<boolean> {
  const rows = await tx.execute<{ ok: boolean }>(sql`
    select a.hash = sha256(coalesce(a.prev_hash, ''::bytea)
                           || convert_to(app_audit_canonical(a)::text, 'UTF8'))
           and (row_number() over w = 1 or a.prev_hash is not distinct from lag(a.hash) over w) as ok
    from audit_event a
    where a.workspace_id is not distinct from ${workspaceId}::uuid
      and (${from?.toISOString() ?? null}::timestamptz is null
           or a.created_at >= ${from?.toISOString() ?? null}::timestamptz)
    window w as (order by a.created_at, a.id)`);
  return rows.every((r) => r.ok);
}

const accountChain = (tx: Queryable, from: Date) =>
  tx.execute<{ id: string | null; reason: string | null }>(
    sql`select id::text, reason from app_audit_verify_account_chain(${from.toISOString()}::timestamptz, null)`,
  );

async function workspaceWith(tx: Transaction, userId: string): Promise<string> {
  const id = randomUUID();
  await withWorkspace(tx, { workspaceId: id }, (s) =>
    s.insert(organization).values({ id, name: 'Chambers', slug: `anon-${id}` }),
  );
  await withWorkspace(tx, { workspaceId: id }, (s) => append(s, id, userId, 'test.ws.first'));
  return id;
}

describe('actor_ref and app_audit_anonymise_actor', () => {
  it('stores a salted actor_ref for user actors and none for system events', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      const ws = await workspaceWith(tx, userId);
      const rows = await withWorkspace(tx, { workspaceId: ws }, async (s) => {
        await append(s, ws, null, 'test.ws.system');
        return s.execute<{ actor: string | null; ref: string | null }>(
          sql`select actor_user_id::text as actor, actor_ref as ref from audit_event
              where workspace_id = ${ws} order by created_at, id`,
        );
      });
      expect(rows[0]?.actor).toBe(userId);
      expect(rows[0]?.ref).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]?.ref).not.toContain(userId.replaceAll('-', ''));
      expect(rows[1]).toEqual({ actor: null, ref: null });
    });
  });

  it('the salt table is owner-only', async () => {
    await withTestDb(async (tx) => {
      expect(await sqlState(tx.execute(sql`select * from audit_actor_salt`))).toBe('42501');
    });
  });

  it('refuses to anonymise a user who still exists', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      expect(
        await sqlState(tx.execute(sql`select app_audit_anonymise_actor(${userId}::uuid)`)),
      ).toBe('42501');
    });
  });

  it('after the user is deleted, nulls actor_user_id in every chain and both chains still verify', async () => {
    await withTestDb(async (tx) => {
      const start = new Date(Date.now() - 1000);
      const userId = await newUser(tx);
      const other = await newUser(tx);
      const ws = await workspaceWith(tx, userId);
      await withWorkspace(tx, { workspaceId: ws }, async (s) => {
        await append(s, ws, other, 'test.ws.other');
        await append(s, ws, userId, 'test.ws.second');
      });
      await withUser(tx, { userId }, (s) => append(s, null, userId, 'test.account.sign_in'));
      const [before] = await withWorkspace(tx, { workspaceId: ws }, (s) =>
        s.execute<{ ref: string }>(
          sql`select actor_ref as ref from audit_event where workspace_id = ${ws} and actor_user_id = ${userId} limit 1`,
        ),
      );

      await tx.delete(user).where(eq(user.id, userId));
      const [result] = await tx.execute<{ n: number }>(
        sql`select app_audit_anonymise_actor(${userId}::uuid)::int as n`,
      );
      expect(result?.n).toBe(3);

      await withWorkspace(tx, { workspaceId: ws }, async (s) => {
        const rows = await s.execute<{ actor: string | null; ref: string | null; action: string }>(
          sql`select actor_user_id::text as actor, actor_ref as ref, action from audit_event
              where workspace_id = ${ws} order by created_at, id`,
        );
        expect(rows.map((r) => r.actor)).toEqual([null, other, null]);
        expect(rows[0]?.ref).toBe(before?.ref);
        expect(await chainOk(s, ws)).toBe(true);
      });
      expect(await accountChain(tx, start)).toEqual([{ id: null, reason: null }]);
      // The salt is gone: the ref can no longer be checked against the old id.
      const [match] = await tx.execute<{ ok: boolean }>(
        sql`select app_audit_actor_ref_matches(${userId}::uuid, ${before?.ref ?? ''}) as ok`,
      );
      expect(match?.ok).toBe(false);
    });
  });

  it('still rejects any other update, even with the anonymise switch on', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      const ws = await workspaceWith(tx, userId);
      expect(
        await sqlState(
          withWorkspace(tx, { workspaceId: ws }, (s) =>
            s.execute(sql`update audit_event set actor_user_id = null where workspace_id = ${ws}`),
          ),
        ),
      ).toBe('42501');
    });
    let caught: string | undefined;
    await owner
      .transaction(async (tx) => {
        const a = await newUser(tx);
        await tx.execute(sql`select set_config('app.user_id', ${a}, true)`);
        const [row] = await append(tx, null, a, 'test.account.update');
        await tx.execute(sql`select set_config('app.audit_anonymise', 'on', true)`);
        caught = await sqlState(
          tx.execute(
            sql`update audit_event set actor_user_id = null, action = 'tampered' where id = ${row?.id}`,
          ),
        );
        tx.rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || !/rollback/i.test(error.message)) throw error;
      });
    expect(caught).toBe('42501');
  });

  it('verifiers report an altered actor_user_id as actor', async () => {
    const start = new Date(Date.now() - 1000);
    let reason: string | null | undefined;
    let wsActorOk: boolean | undefined;
    await owner
      .transaction(async (tx) => {
        const a = await newUser(tx);
        const b = await newUser(tx);
        await tx.execute(sql`select set_config('app.user_id', ${a}, true)`);
        const [row] = await append(tx, null, a, 'test.account.tamper');
        await tx.execute(sql`alter table audit_event disable trigger audit_event_immutable`);
        await tx.execute(sql`update audit_event set actor_user_id = ${b} where id = ${row?.id}`);
        const rows = await accountChain(tx, start);
        reason = rows[0]?.reason;
        const [check] = await tx.execute<{ ok: boolean }>(
          sql`select app_audit_actor_ref_matches(actor_user_id, actor_ref) as ok
              from audit_event where id = ${row?.id}`,
        );
        wsActorOk = check?.ok;
        tx.rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || !/rollback/i.test(error.message)) throw error;
      });
    expect(wsActorOk).toBe(false);
    expect(reason).toBe('actor');
  });
});

/** The migrations folder up to (not including) 0031, to stage legacy audit rows. */
function migrationsBefore0031(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'causedeck-migrations-0029-'));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
  // Drop 0031 and every later migration: the migrator applies by timestamp, so a later one left
  // in the staged folder would be applied first and 0031 then skipped as already behind.
  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  for (const e of journal.entries.filter((entry) => entry.idx >= 31)) {
    rmSync(path.join(dir, `${e.tag}.sql`));
  }
  journal.entries = journal.entries.filter((e) => e.idx < 31);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

async function legacyDatabase(name: string) {
  const db = await createScratchDatabase(testDatabaseUrls(), name);
  cleanups.push(db.drop);
  await runMigrations({ url: new Secret(db.owner), migrationsFolder: migrationsBefore0031() });
  const app = createDb({ url: new Secret(db.app), role: 'app', max: 1 });
  cleanups.push(() => app.$client.end());
  const ids = await app.transaction(async (tx) => {
    const userId = await newUser(tx);
    const ws = await workspaceWith(tx, userId);
    await withWorkspace(tx, { workspaceId: ws }, async (s) => {
      await append(s, ws, null, 'test.ws.system');
      await append(s, ws, userId, 'test.ws.again');
    });
    await withUser(tx, { userId }, async (s) => {
      await append(s, null, userId, 'test.account.one');
      await append(s, null, userId, 'test.account.two');
    });
    return { userId, ws };
  });
  return { db, app, ...ids };
}

describe('0031 re-chain of legacy audit rows', () => {
  it('backfills actor_ref and keeps every chain valid', async () => {
    const { db, app, userId, ws } = await legacyDatabase('audit_rechain_ok');
    const result = await runMigrations({ url: new Secret(db.owner) });
    // 0031 first; later migrations (e.g. 0032) follow it.
    expect(result.applied[0]).toBe('0031_account_memory_erasure');
    const migrated = createOwnerDb(new Secret(db.owner));
    cleanups.push(() => migrated.$client.end());
    const rows = await migrated.execute<{ actor: string | null; ref: string | null }>(
      sql`select actor_user_id::text as actor, actor_ref as ref from audit_event`,
    );
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.ref === null).toBe(row.actor === null);
    expect(await chainOk(migrated, ws)).toBe(true);
    expect(await chainOk(migrated, null)).toBe(true);
    // A legacy user can now be anonymised.
    const n = await app.transaction(async (tx) => {
      await tx.delete(user).where(eq(user.id, userId));
      const [row] = await tx.execute<{ n: number }>(
        sql`select app_audit_anonymise_actor(${userId}::uuid)::int as n`,
      );
      return row?.n;
    });
    expect(n).toBe(4);
    expect(await chainOk(migrated, ws)).toBe(true);
    expect(await chainOk(migrated, null)).toBe(true);
  });

  it('refuses to re-chain over a chain that is already broken', async () => {
    const { db, ws } = await legacyDatabase('audit_rechain_broken');
    const legacy = createOwnerDb(new Secret(db.owner));
    cleanups.push(() => legacy.$client.end());
    // Remove a middle event through the retention switch (owner_definer_purge): a broken link.
    await legacy.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.audit_retention', 'on', true)`);
      await tx.execute(
        sql`delete from audit_event where workspace_id = ${ws} and action = 'test.ws.system'`,
      );
    });
    await expect(runMigrations({ url: new Secret(db.owner) })).rejects.toThrow();
    const [row] = await legacy.execute<{ n: number }>(
      sql`select count(*)::int as n from information_schema.columns
          where table_name = 'audit_event' and column_name = 'actor_ref'`,
    );
    expect(row?.n).toBe(0);
  });
});
