// The audit hash chain through record() and verifyChain (#227, #26 part 2): concurrent writers in
// one workspace form one linear chain (advisory lock, no forks), and verifyChain reports a row a
// superuser altered behind the immutability trigger.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, withWorkspace, type Transaction } from '@causedeck/db';
import { testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { record, verifyChain } from '../index.ts';

const CONCURRENT = 16;
const committedWorkspace = randomUUID();

const app = createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 8 });
const superuser = createDb({
  url: new Secret(testDatabaseUrls().superuser),
  role: 'owner',
  max: 1,
});

afterAll(async () => {
  // The concurrency test committed its rows; remove them through the retention switch.
  try {
    await superuser.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.audit_retention', 'on', true)`);
      await tx.execute(
        sql`delete from audit_event where workspace_id = ${committedWorkspace}::uuid`,
      );
    });
  } finally {
    await superuser.$client.end();
    await app.$client.end();
  }
});

const system = (db: Transaction, workspaceId: string) => ({
  db,
  workspaceId,
  actor: { userId: null, kind: 'system' as const },
});

async function chainRows(tx: Transaction, workspaceId: string) {
  return withWorkspace(tx, { workspaceId }, (s) =>
    s
      .select({
        id: schema.auditEvent.id,
        prevHash: schema.auditEvent.prevHash,
        hash: schema.auditEvent.hash,
        createdAt: schema.auditEvent.createdAt,
      })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.workspaceId, workspaceId))
      .orderBy(asc(schema.auditEvent.createdAt), asc(schema.auditEvent.id)),
  );
}

/** Run `fn` as the superuser in a transaction that is always rolled back. */
async function asSuperuser(fn: (tx: Transaction) => Promise<void>): Promise<void> {
  const rollback = new Error('rollback');
  await superuser
    .transaction(async (tx) => {
      await fn(tx);
      throw rollback;
    })
    .catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
}

describe('audit chain', () => {
  it('serialises concurrent record() calls in one workspace into one linear chain', async () => {
    await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        app.transaction((tx) =>
          record(system(tx, committedWorkspace), {
            action: 'member.role_changed',
            metadata: { n: i },
          }),
        ),
      ),
    );
    await app.transaction(async (tx) => {
      const rows = await chainRows(tx, committedWorkspace);
      expect(rows).toHaveLength(CONCURRENT);
      expect(rows[0]?.prevHash).toBeNull();
      rows.slice(1).forEach((row, i) => {
        expect(row.prevHash?.equals(rows[i]?.hash ?? Buffer.alloc(0)), `row ${String(i + 1)}`).toBe(
          true,
        );
      });
      expect(new Set(rows.map((r) => r.prevHash?.toString('hex') ?? null)).size).toBe(CONCURRENT);
      expect(await verifyChain(tx, committedWorkspace)).toEqual({ ok: true, checked: CONCURRENT });
    });
  });

  it('detects a row a superuser altered behind the immutability trigger', async () => {
    await asSuperuser(async (tx) => {
      const workspaceId = randomUUID();
      for (const n of [1, 2, 3]) {
        await record(system(tx, workspaceId), { action: 'member.removed', metadata: { n } });
      }
      expect(await verifyChain(tx, workspaceId)).toEqual({ ok: true, checked: 3 });
      const [, middle] = await chainRows(tx, workspaceId);
      if (!middle) throw new Error('chain missing');

      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(
        sql`update audit_event set metadata = '{"n":99}'::jsonb where id = ${middle.id}::uuid`,
      );
      await tx.execute(sql`set local session_replication_role = origin`);

      expect(await verifyChain(tx, workspaceId)).toEqual({
        ok: false,
        checked: 3,
        brokenAt: { id: middle.id, reason: 'hash' },
      });
    });
  });

  it('detects a re-hashed row by its broken link to the next event', async () => {
    await asSuperuser(async (tx) => {
      const workspaceId = randomUUID();
      for (const n of [1, 2, 3]) {
        await record(system(tx, workspaceId), { action: 'member.removed', metadata: { n } });
      }
      const [, middle, last] = await chainRows(tx, workspaceId);
      if (!middle || !last) throw new Error('chain missing');
      await tx.execute(sql`set local session_replication_role = replica`);
      // A careful forger also recomputes the altered row's hash: the next row no longer links.
      await tx.execute(sql`
        update audit_event a set metadata = '{"n":99}'::jsonb where a.id = ${middle.id}::uuid`);
      await tx.execute(sql`
        update audit_event a
        set hash = sha256(coalesce(a.prev_hash, ''::bytea)
                          || convert_to(app_audit_canonical(a)::text, 'UTF8'))
        where a.id = ${middle.id}::uuid`);
      await tx.execute(sql`set local session_replication_role = origin`);

      expect(await verifyChain(tx, workspaceId)).toEqual({
        ok: false,
        checked: 3,
        brokenAt: { id: last.id, reason: 'link' },
      });
    });
  });

  it('verifies a created_at range, taking the first prev_hash in range as its anchor', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      for (const n of [1, 2, 3, 4]) {
        await record(system(tx, workspaceId), { action: 'member.removed', metadata: { n } });
        // Range bounds are JS Dates (milliseconds); keep events apart so they are exact.
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const rows = await chainRows(tx, workspaceId);
      const second = rows[1]?.createdAt;
      const fourth = rows[3]?.createdAt;
      if (!second || !fourth) throw new Error('chain missing');
      expect(await verifyChain(tx, workspaceId, { from: second, to: fourth })).toEqual({
        ok: true,
        checked: 2,
      });
      expect(await verifyChain(tx, workspaceId, { from: second })).toEqual({
        ok: true,
        checked: 3,
      });
      expect(await verifyChain(tx, randomUUID())).toEqual({ ok: true, checked: 0 });
    });
  });
});
