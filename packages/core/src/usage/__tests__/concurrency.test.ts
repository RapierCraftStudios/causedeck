// The usage meter under concurrency (#219): increments commit on separate pooled connections, so
// this cannot use the shared rolled-back transaction. It commits to the shared test database in
// freshly seeded workspaces (random ids, so parallel files never collide) and deletes them after.
import { Secret } from '@causedeck/config/env';
import { createDb, schema, type Database } from '@causedeck/db';
import { inWorkspace, testDatabaseUrls } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getUsage, increment } from '../meter.ts';

const { usageEvent } = schema;

let db: Database;
let workspaceId: string;
let seeded: string[] = [];

beforeAll(async () => {
  db = createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 20 });
  const { a, b } = await db.transaction((tx) => seedTwoTenants(tx));
  workspaceId = a.id;
  seeded = [a.id, b.id];
});

afterAll(async () => {
  // Usage rows cascade from the workspace.
  for (const id of seeded) {
    await db.transaction((tx) =>
      inWorkspace(tx, id, (s) =>
        s.delete(schema.organization).where(eq(schema.organization.id, id)),
      ),
    );
  }
  await db.$client.end();
});

async function ledgerRows(key: string): Promise<number> {
  const [row] = await db.transaction((tx) =>
    inWorkspace(tx, workspaceId, (s) =>
      s
        .select({ n: count() })
        .from(usageEvent)
        .where(and(eq(usageEvent.workspaceId, workspaceId), eq(usageEvent.key, key))),
    ),
  );
  return row?.n ?? 0;
}

describe('usage meter: concurrency', () => {
  it('100 concurrent increments of 1 give exactly 100, and replays never double count', async () => {
    const ctx = { db, workspaceId };
    const keys = Array.from({ length: 100 }, (_, i) => `conc-${String(i)}`);
    const results = await Promise.all(
      keys.map((idempotencyKey) => increment(ctx, 'ai.spend_paise', 1, { idempotencyKey })),
    );
    expect(results.every((r) => r.applied)).toBe(true);
    expect(results.map((r) => r.value).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual(
      keys.map((_, i) => i + 1),
    );
    expect(await getUsage(ctx, 'ai.spend_paise')).toBe(100);
    expect(await ledgerRows('ai.spend_paise')).toBe(100);

    const replays = await Promise.all(
      Array.from({ length: 10 }, () =>
        increment(ctx, 'ai.spend_paise', 1, { idempotencyKey: 'conc-7' }),
      ),
    );
    expect(replays.every((r) => !r.applied)).toBe(true);
    expect(await getUsage(ctx, 'ai.spend_paise')).toBe(100);
    expect(await ledgerRows('ai.spend_paise')).toBe(100);
  });

  it('applies exactly one of 10 concurrent first calls with the same key', async () => {
    const ctx = { db, workspaceId };
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        increment(ctx, 'ocr.pages', 3, { idempotencyKey: 'same-first' }),
      ),
    );
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(await getUsage(ctx, 'ocr.pages')).toBe(3);
    expect(await ledgerRows('ocr.pages')).toBe(1);
  });
});
