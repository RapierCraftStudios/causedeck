// The API key quota under concurrency (#639): calls commit on separate pooled connections, so this
// cannot use the shared rolled-back transaction. It commits to the shared test database in freshly
// seeded workspaces (random ids) and deletes them after.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, type Database } from '@causedeck/db';
import { inWorkspace, testDatabaseUrls } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getUsage } from '../../usage/index.ts';
import { authenticateApiKey, consumeApiCall, createApiKey, type ApiKeyIdentity } from '../index.ts';

let db: Database;
let workspaceId: string;
let userId: string;
let seeded: string[] = [];

beforeAll(async () => {
  db = createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 20 });
  const { a, b, ua } = await db.transaction((tx) => seedTwoTenants(tx));
  workspaceId = a.id;
  userId = ua;
  seeded = [a.id, b.id];
});

afterAll(async () => {
  for (const id of seeded) {
    await db.transaction((tx) =>
      inWorkspace(tx, id, (s) =>
        s.delete(schema.organization).where(eq(schema.organization.id, id)),
      ),
    );
  }
  await db.$client.end();
});

async function identityWithQuota(monthlyQuota: number): Promise<ApiKeyIdentity> {
  const { token } = await createApiKey(db, {
    workspaceId,
    actorUserId: userId,
    name: `conc-${String(monthlyQuota)}`,
    scopes: ['cases:read'],
    monthlyQuota,
  });
  const identity = await authenticateApiKey(db, token);
  if (!identity) throw new Error('key did not authenticate');
  return identity;
}

describe('api key quota: concurrent calls', () => {
  it('N concurrent calls against a key with K remaining succeed exactly K times', async () => {
    const identity = await identityWithQuota(5);
    const ctx = { db, workspaceId };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeApiCall(ctx, identity, randomUUID())),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => !r.allowed)).toHaveLength(15);
    expect(
      results
        .filter((r) => r.allowed)
        .map((r) => r.used)
        .sort((x, y) => x - y),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('a quota of 0 blocks every concurrent call and bills nothing', async () => {
    const identity = await identityWithQuota(0);
    const ctx = { db, workspaceId };
    const before = await getUsage(ctx, 'api.calls');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeApiCall(ctx, identity, randomUUID())),
    );
    expect(results.every((r) => !r.allowed)).toBe(true);
    expect(await getUsage(ctx, 'api.calls')).toBe(before);
  });

  it('fails closed when the database errors', async () => {
    const identity = await identityWithQuota(5);
    const broken = { db: {} as Database, workspaceId };
    await expect(consumeApiCall(broken, identity, randomUUID())).rejects.toThrow();
  });
});
