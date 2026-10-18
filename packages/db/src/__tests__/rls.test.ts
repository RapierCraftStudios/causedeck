// withWorkspace (minimal, #15): transaction-local workspace context. RLS policies arrive in #19.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb } from '../client.ts';
import { withWorkspace } from '../rls.ts';
import { testDatabaseUrls } from '../testing/index.ts';

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
