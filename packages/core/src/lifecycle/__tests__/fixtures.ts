// Shared fixtures for the lifecycle export tests (#301). The build opens its own `withWorkspace`
// transactions concurrently (the upload runs alongside the exporters), so these tests commit to the
// shared migrated test database through their own app-role pool, in fresh two-tenant workspaces
// that `cleanup` deletes again (every tenant row cascades from the workspace).
import { Secret } from '@causedeck/config/env';
import { createDb, schema, withWorkspace, type Database } from '@causedeck/db';
import { testDatabaseUrls } from '@causedeck/db/testing';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import {
  createMemoryObjectStore,
  EnvKeyProvider,
  kekFromBase64,
  type MemoryObjectStore,
  type ObjectKey,
} from '@causedeck/storage';
import { eq } from 'drizzle-orm';

import type { Logger } from '@causedeck/observability';

export const SECRET = 'test-export-signing-secret-0123456789abcdef';

export function lifecycleDb(max = 8): Database {
  return createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max });
}

export function testKeys(): EnvKeyProvider {
  return new EnvKeyProvider([kekFromBase64('kek-test', Buffer.alloc(32, 7).toString('base64'))]);
}

/** Seed A and B, and put a plaintext object behind each seeded `blob` row. */
export async function seedWorkspaces(db: Database, store: MemoryObjectStore): Promise<TwoTenants> {
  const seeded = await db.transaction((tx) => seedTwoTenants(tx));
  for (const ws of [seeded.a, seeded.b]) {
    const rows = await withWorkspace(db, { workspaceId: ws.id }, (tx) =>
      tx.select({ key: schema.blob.key, id: schema.blob.id }).from(schema.blob),
    );
    for (const row of rows) {
      await store.put({
        key: row.key as ObjectKey,
        body: Buffer.from(`seed file ${row.id}`),
        contentType: 'application/pdf',
      });
    }
  }
  return seeded;
}

export async function cleanup(db: Database, workspaceIds: readonly string[]): Promise<void> {
  for (const id of workspaceIds) {
    await withWorkspace(db, { workspaceId: id }, (tx) =>
      tx.delete(schema.organization).where(eq(schema.organization.id, id)),
    );
  }
  await db.$client.end();
}

export function newStore(): MemoryObjectStore {
  return createMemoryObjectStore();
}

/** A logger that keeps every call's arguments, serialized. */
export function captureLog(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const push = (...args: unknown[]) => {
    lines.push(JSON.stringify(args));
  };
  const log = {
    info: push,
    warn: push,
    error: push,
    debug: push,
    fatal: push,
    trace: push,
    child: () => log,
  } as unknown as Logger;
  return { log, lines };
}

export async function readAll(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}
