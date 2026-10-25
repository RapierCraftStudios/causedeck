// Tenancy scopes (#15, #19): transaction-local workspace context, nesting rules and the user-only
// and global scopes. Policy behaviour is in ./rls/*.test.ts.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb } from '../client.ts';
import {
  currentScope,
  TENANCY_VIOLATION,
  TenancyError,
  withoutWorkspace,
  withUser,
  withWorkspace,
} from '../rls.ts';
import { testDatabaseUrls, withTestDb } from '../testing/index.ts';

const current = sql`select nullif(current_setting('app.workspace_id', true), '') as ws, nullif(current_setting('app.user_id', true), '') as uid`;

// One connection, so the pooling assertions are about the same session.
const db = createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 1 });

afterAll(async () => {
  await db.$client.end();
});

describe('withWorkspace', () => {
  it('sets app.workspace_id and app.user_id for the transaction', async () => {
    const workspaceId = randomUUID();
    const userId = randomUUID();
    const rows = await withWorkspace(db, { workspaceId, userId }, (tx) =>
      tx.execute<{ ws: string | null; uid: string | null }>(current),
    );
    expect(rows[0]).toEqual({ ws: workspaceId, uid: userId });
  });

  it('is transaction-local: a reused pooled connection sees no workspace', async () => {
    await withWorkspace(db, { workspaceId: randomUUID() }, () => Promise.resolve(undefined));
    const rows = await db.execute<{ ws: string | null; uid: string | null }>(current);
    expect(rows[0]).toEqual({ ws: null, uid: null });
  });

  it('rolls back with the callback', async () => {
    await expect(
      withWorkspace(db, { workspaceId: randomUUID() }, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    const rows = await db.execute<{ ws: string | null }>(current);
    expect(rows[0]?.ws).toBeNull();
  });

  it('rejects empty or invalid ids before opening a transaction', async () => {
    for (const workspaceId of ['', 'not-a-uuid', "x'; drop table job_effect; --"]) {
      await expect(
        withWorkspace(db, { workspaceId }, () => Promise.resolve(undefined)),
      ).rejects.toThrow(/workspaceId must be a uuid/);
    }
    await expect(
      withWorkspace(db, { workspaceId: randomUUID(), userId: 'nope' }, () =>
        Promise.resolve(undefined),
      ),
    ).rejects.toThrow(/userId must be a uuid/);
  });
});

async function tenancyCode(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(TenancyError);
  return (error as TenancyError).code;
}

describe('withWorkspace nesting', () => {
  it('throws TENANCY_VIOLATION when nested with a different workspace', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await expect(
      tenancyCode(
        withWorkspace(db, { workspaceId: a }, (tx) =>
          withWorkspace(tx, { workspaceId: b }, () => Promise.resolve(1)),
        ),
      ),
    ).resolves.toBe(TENANCY_VIOLATION);
    // A separate connection opened inside the scope is still nested in the same call chain.
    await expect(
      tenancyCode(
        withWorkspace(db, { workspaceId: a }, () =>
          withWorkspace(db, { workspaceId: b }, () => Promise.resolve(1)),
        ),
      ),
    ).resolves.toBe(TENANCY_VIOLATION);
  });

  it('allows nesting the same workspace', async () => {
    const a = randomUUID();
    const rows = await withWorkspace(db, { workspaceId: a }, (tx) =>
      withWorkspace(tx, { workspaceId: a.toUpperCase() }, (inner) =>
        inner.execute<{ ws: string | null; uid: string | null }>(current),
      ),
    );
    expect(rows[0]?.ws?.toLowerCase()).toBe(a);
  });

  it('sequential scopes on one outer transaction do not leak into each other or afterwards', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await withTestDb(async (tx) => {
      const seenA = await withWorkspace(tx, { workspaceId: a }, (s) =>
        s.execute<{ ws: string | null }>(current),
      );
      const between = await tx.execute<{ ws: string | null }>(current);
      const seenB = await withWorkspace(tx, { workspaceId: b }, (s) =>
        s.execute<{ ws: string | null }>(current),
      );
      const after = await tx.execute<{ ws: string | null }>(current);
      expect([seenA[0]?.ws, between[0]?.ws, seenB[0]?.ws, after[0]?.ws]).toEqual([
        a,
        null,
        b,
        null,
      ]);
    });
  });

  it('restores the outer scope when a nested same-workspace scope changes the user', async () => {
    const a = randomUUID();
    const [u1, u2] = [randomUUID(), randomUUID()];
    const rows = await withWorkspace(db, { workspaceId: a, userId: u1 }, async (tx) => {
      await withWorkspace(tx, { workspaceId: a, userId: u2 }, () => Promise.resolve(undefined));
      return tx.execute<{ ws: string | null; uid: string | null }>(current);
    });
    expect(rows[0]).toEqual({ ws: a, uid: u1 });
  });

  it('exposes the active scope and clears it afterwards', async () => {
    const a = randomUUID();
    const inside = await withWorkspace(db, { workspaceId: a }, () =>
      Promise.resolve(currentScope()),
    );
    expect(inside).toEqual({ kind: 'workspace', workspaceId: a, userId: null });
    expect(currentScope()).toBeUndefined();
  });
});

describe('withUser', () => {
  it('pins app.user_id alone', async () => {
    const userId = randomUUID();
    const rows = await withUser(db, { userId }, (tx) =>
      tx.execute<{ ws: string | null; uid: string | null }>(current),
    );
    expect(rows[0]).toEqual({ ws: null, uid: userId });
  });

  it('rejects an invalid user id and cannot widen a workspace scope', async () => {
    await expect(withUser(db, { userId: 'nope' }, () => Promise.resolve(1))).rejects.toThrow(
      /userId must be a uuid/,
    );
    await expect(
      tenancyCode(
        withWorkspace(db, { workspaceId: randomUUID() }, (tx) =>
          withUser(tx, { userId: randomUUID() }, () => Promise.resolve(1)),
        ),
      ),
    ).resolves.toBe(TENANCY_VIOLATION);
  });

  it('narrows to a workspace inside a user scope and restores the user scope', async () => {
    const userId = randomUUID();
    const a = randomUUID();
    const rows = await withUser(db, { userId }, async (tx) => {
      await withWorkspace(tx, { workspaceId: a, userId }, () => Promise.resolve(undefined));
      return tx.execute<{ ws: string | null; uid: string | null }>(current);
    });
    expect(rows[0]).toEqual({ ws: null, uid: userId });
  });
});

describe('withoutWorkspace', () => {
  it('runs for allow-listed global tables with no workspace or user pinned', async () => {
    const rows = await withoutWorkspace(db, { tables: ['api_idempotency_key'] }, (tx) =>
      tx.execute<{ ws: string | null; uid: string | null }>(current),
    );
    expect(rows[0]).toEqual({ ws: null, uid: null });
  });

  it('rejects tenant tables, an empty list and nesting inside a scope', async () => {
    for (const tables of [['member'], ['user', 'job_effect'], []]) {
      await expect(
        tenancyCode(withoutWorkspace(db, { tables }, () => Promise.resolve(1))),
      ).resolves.toBe(TENANCY_VIOLATION);
    }
    await expect(
      tenancyCode(
        withWorkspace(db, { workspaceId: randomUUID() }, () =>
          withoutWorkspace(db, { tables: ['user'] }, () => Promise.resolve(1)),
        ),
      ),
    ).resolves.toBe(TENANCY_VIOLATION);
  });
});
