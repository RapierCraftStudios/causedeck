// Shared fixtures for the workspace deletion tests (#302). Like the export tests, they commit to the
// shared migrated test database through their own app-role pool (the erase opens its own
// `withWorkspace` transactions per step), in fresh two-tenant workspaces. `countRows` reads as the
// bootstrap superuser, which row-level security does not bind, so it sees every workspace's rows.
import { Secret } from '@causedeck/config/env';
import { createDb, schema, withWorkspace, type Database } from '@causedeck/db';
import { testDatabaseUrls } from '@causedeck/db/testing';
import { TABLE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import type { EmailMessage, EmailTransport } from '@causedeck/notifications/email';
import { encryptForWorkspace, objectKey, type MemoryObjectStore } from '@causedeck/storage';
import { and, eq, sql } from 'drizzle-orm';

import type { EraseDeps } from '../index.ts';

import { readAll, SECRET, testKeys } from './fixtures.ts';

export const DAY = 24 * 60 * 60 * 1000;

/** A fake clock that moves forward one second on every read, so step times strictly increase. */
export function fakeClock(start: Date): { now: () => Date; set: (at: Date) => void } {
  let at = start.getTime();
  return {
    now: () => {
      at += 1000;
      return new Date(at);
    },
    set: (next: Date) => {
      at = next.getTime();
    },
  };
}

export interface SpyEmail extends EmailTransport {
  sent: EmailMessage[];
}

export function spyEmail(onSend?: (message: EmailMessage) => Promise<void>): SpyEmail {
  const sent: EmailMessage[] = [];
  return {
    provider: 'console',
    sent,
    send: async (message) => {
      await onSend?.(message);
      sent.push(message);
      return {};
    },
  };
}

export function eraseDeps(
  store: MemoryObjectStore,
  email: EmailTransport,
  now: () => Date,
  extra: Partial<EraseDeps> = {},
): EraseDeps {
  return { store, email, secret: SECRET, appUrl: 'https://app.causedeck.test', now, ...extra };
}

/** Deliveries are not under test here: accept and drop them. */
export const noDelivery = { enqueueDelivery: () => Promise.resolve(null) };

/** Store one encrypted object for the workspace; returns its ciphertext and plaintext. */
export async function storeEncrypted(
  db: Database,
  store: MemoryObjectStore,
  workspaceId: string,
): Promise<{ ciphertext: Buffer; plaintext: Buffer }> {
  const plaintext = Buffer.from(`privileged note for ${workspaceId}`);
  const ciphertext = await readAll(
    await encryptForWorkspace(db, testKeys(), workspaceId, [plaintext]),
  );
  await store.put({
    key: objectKey({ workspaceId, kind: 'document', id: crypto.randomUUID() }, new Date()),
    body: ciphertext,
    contentType: 'application/octet-stream',
  });
  return { ciphertext, plaintext };
}

/** The bootstrap superuser (row-level security does not bind it), for whole-database reads. */
export function superuserDb(): Database {
  return createDb({ url: new Secret(testDatabaseUrls().superuser), role: 'owner', max: 1 });
}

/** Rows per tenant table (and the global tables that name a workspace) for `workspaceId`. */
export async function countRows(
  su: Database,
  workspaceId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of [...Object.keys(TABLE_TESTS), 'api_idempotency_key']) {
    const column = table === 'organization' ? 'id' : 'workspace_id';
    const [row] = await su.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${workspaceId}::uuid`,
    );
    counts[table] = row?.n ?? 0;
  }
  const [sessions] = await su.execute<{ n: number }>(
    sql`select count(*)::int as n from session where active_organization_id = ${workspaceId}::uuid`,
  );
  counts.session = sessions?.n ?? 0;
  return counts;
}

/** Make `userId` an owner of `workspaceId` (a second owner for the cancel tests). */
export async function makeOwner(db: Database, workspaceId: string, userId: string): Promise<void> {
  await withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .update(schema.member)
      .set({ role: 'owner' })
      .where(and(eq(schema.member.organizationId, workspaceId), eq(schema.member.userId, userId))),
  );
}

/** A signed-in session whose active workspace is `workspaceId`. */
export async function addSession(db: Database, workspaceId: string, userId: string): Promise<void> {
  await db.insert(schema.session).values({
    token: crypto.randomUUID(),
    userId,
    activeOrganizationId: workspaceId,
    expiresAt: new Date(Date.now() + DAY),
  });
}
