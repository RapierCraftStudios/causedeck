// SET LOCAL semantics (#19): the workspace pinned by withWorkspace lives only as long as its
// transaction, so the next transaction on the same pooled connection sees no workspace and no rows.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from '../../client.ts';
import { withWorkspace } from '../../rls.ts';
import { member, organization, user } from '../../schema/auth.ts';
import { testDatabaseUrls } from '../../testing/index.ts';

// One connection, so every query below runs on the same session.
const db = createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 1 });
const workspaceId = randomUUID();
let userId = '';

const settings = sql`select nullif(current_setting('app.workspace_id', true), '') as ws, nullif(current_setting('app.user_id', true), '') as uid`;

beforeAll(async () => {
  // Committed (this suite needs a second transaction to see the first one's rows).
  const [u] = await db
    .insert(user)
    .values({ name: 'Pooled', email: `${randomUUID()}@example.test` })
    .returning({ id: user.id });
  userId = u?.id ?? '';
  await withWorkspace(db, { workspaceId }, async (tx) => {
    await tx
      .insert(organization)
      .values({ id: workspaceId, name: 'Pool', slug: `pool-${workspaceId}` });
    await tx.insert(member).values({ organizationId: workspaceId, userId, role: 'advocate' });
  });
});

afterAll(async () => {
  // Deleting the workspace cascades to its members (RI actions are not subject to RLS).
  await withWorkspace(db, { workspaceId }, (tx) =>
    tx.delete(organization).where(eq(organization.id, workspaceId)),
  );
  await db.delete(user).where(eq(user.id, userId));
  await db.$client.end();
});

describe('withWorkspace on a pooled connection (max: 1)', () => {
  it('sees the workspace inside the helper and nothing on the reused connection afterwards', async () => {
    const inside = await withWorkspace(db, { workspaceId, userId }, async (tx) => ({
      gucs: (await tx.execute<{ ws: string | null; uid: string | null }>(settings))[0],
      rows: (await tx.select().from(member)).length,
    }));
    expect(inside).toEqual({ gucs: { ws: workspaceId, uid: userId }, rows: 1 });

    const after = await db.transaction(async (tx) => ({
      gucs: (await tx.execute<{ ws: string | null; uid: string | null }>(settings))[0],
      rows: (await tx.select().from(member).where(eq(member.organizationId, workspaceId))).length,
    }));
    expect(after).toEqual({ gucs: { ws: null, uid: null }, rows: 0 });

    // Outside any transaction too.
    expect((await db.select().from(member)).length).toBe(0);
  });

  it('a failed scoped transaction leaves nothing behind either', async () => {
    await expect(
      withWorkspace(db, { workspaceId }, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect((await db.execute<{ ws: string | null }>(settings))[0]?.ws).toBeNull();
    expect((await db.select().from(organization)).length).toBe(0);
  });
});
