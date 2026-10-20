// Workspace keys (#216; docs/engineering/storage.md). Each workspace has one DEK, stored wrapped
// under a KEK in `workspace_key` (AAD = workspace id). Every read and write runs inside
// `withWorkspace`, so FORCE row-level security keeps one workspace from touching another's key.
//   ensureWorkspaceKey   create the DEK on first use (never re-creates a destroyed one)
//   getWorkspaceDek      unwrap it, with the KEK the row names (not the one in an object header)
//   destroyWorkspaceKey  crypto-erase (#31): zero the wrapped DEK and mark it destroyed
//   rewrapAll            KEK rotation: re-wrap every live DEK under a new KEK; objects untouched
// Workspace deletion (#302) later purges the zeroed key row with the rest of the workspace; a
// `deletion_tombstone` then stands in for it, so the key still reads as `KEY_DESTROYED` (never
// `NO_WORKSPACE_KEY`) and is never re-created.
import { withWorkspace, type Queryable, type Transaction } from '@causedeck/db';
import { deletionTombstone, workspaceKey } from '@causedeck/db/schema';
import type { Secret } from '@causedeck/config/env';
import { eq, sql } from 'drizzle-orm';

import { generateDek, unwrapDek, wrapDek } from './crypto/dek.ts';
import {
  decryptStream,
  encryptStream,
  type ByteSource,
  type EncryptOptions,
} from './crypto/envelope.ts';
import { StorageCryptoError } from './crypto/errors.ts';
import type { KeyProvider } from './crypto/kek.ts';

/** The kek id recorded on a tombstone row written by erasing a workspace that never had a key. */
export const DESTROYED_KEK_ID = 'destroyed';

/** Length of a wrapped DEK from `EnvKeyProvider` (nonce 12 + key 32 + tag 16). */
const WRAPPED_DEK_BYTES = 60;

type KeyRow = typeof workspaceKey.$inferSelect;

async function readKey(tx: Transaction, workspaceId: string, lock = false): Promise<KeyRow | null> {
  const query = tx.select().from(workspaceKey).where(eq(workspaceKey.workspaceId, workspaceId));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/** Whether the workspace was erased (#302): its key row is gone, its tombstone stays. */
async function erased(tx: Transaction, workspaceId: string): Promise<boolean> {
  const [row] = await tx
    .select({ workspaceId: deletionTombstone.workspaceId })
    .from(deletionTombstone)
    .where(eq(deletionTombstone.workspaceId, workspaceId));
  return row !== undefined;
}

function destroyed(): StorageCryptoError {
  return new StorageCryptoError('KEY_DESTROYED', 'the workspace key was destroyed');
}

export interface EnsuredKey {
  kekId: string;
  created: boolean;
}

/** Make sure `workspaceId` has a DEK; `KEY_DESTROYED` if it was crypto-erased. Idempotent. */
export function ensureWorkspaceKey(
  db: Queryable,
  provider: KeyProvider,
  workspaceId: string,
): Promise<EnsuredKey> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const existing = await readKey(tx, workspaceId);
    if (existing === null) {
      if (await erased(tx, workspaceId)) throw destroyed();
      const kekId = provider.currentKekId();
      const wrappedDek = await wrapDek(provider, kekId, generateDek(), workspaceId);
      const inserted = await tx
        .insert(workspaceKey)
        .values({ workspaceId, wrappedDek, kekId })
        .onConflictDoNothing()
        .returning({ kekId: workspaceKey.kekId });
      if (inserted.length > 0) return { kekId, created: true };
    }
    const row = existing ?? (await readKey(tx, workspaceId));
    if (row === null) throw new StorageCryptoError('NO_WORKSPACE_KEY', 'workspace has no key');
    if (row.destroyedAt !== null) throw destroyed();
    return { kekId: row.kekId, created: false };
  });
}

/**
 * The workspace's DEK. `KEY_DESTROYED` after crypto-erase (also once the erased workspace's key row
 * was purged), `NO_WORKSPACE_KEY` before creation.
 */
export function getWorkspaceDek(
  db: Queryable,
  provider: KeyProvider,
  workspaceId: string,
): Promise<Secret<Buffer>> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const row = await readKey(tx, workspaceId);
    if (row === null) {
      if (await erased(tx, workspaceId)) throw destroyed();
      throw new StorageCryptoError('NO_WORKSPACE_KEY', 'workspace has no key');
    }
    if (row.destroyedAt !== null) throw destroyed();
    return unwrapDek(provider, row.kekId, row.wrappedDek, workspaceId);
  });
}

/**
 * Crypto-erase (#31): overwrite the wrapped DEK with zero bytes and set `destroyed_at`. Without the
 * DEK every object and field of the workspace is unreadable, the KEK notwithstanding. The row
 * stays as a tombstone so `ensureWorkspaceKey` cannot quietly start a fresh key. Idempotent.
 */
export function destroyWorkspaceKey(
  db: Queryable,
  workspaceId: string,
): Promise<{ destroyed: boolean }> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const updated = await tx
      .update(workspaceKey)
      .set({
        wrappedDek: sql`decode(repeat('00', length(${workspaceKey.wrappedDek})), 'hex')`,
        destroyedAt: sql`coalesce(${workspaceKey.destroyedAt}, now())`,
      })
      .where(eq(workspaceKey.workspaceId, workspaceId))
      .returning({ workspaceId: workspaceKey.workspaceId });
    if (updated.length === 0) {
      await tx
        .insert(workspaceKey)
        .values({
          workspaceId,
          wrappedDek: Buffer.alloc(WRAPPED_DEK_BYTES),
          kekId: DESTROYED_KEK_ID,
          destroyedAt: new Date(),
        })
        .onConflictDoNothing();
    }
    return { destroyed: true };
  });
}

/** Workspaces whose live key is not yet wrapped under `kekId` (ids only, across tenants). */
export async function pendingRewrap(db: Queryable, kekId: string): Promise<string[]> {
  const rows = await db.execute<{ workspace_id: string }>(
    sql`select k.workspace_id from app_workspace_keys_for_rewrap(${kekId}) as k(workspace_id)`,
  );
  return rows.map((r) => r.workspace_id);
}

export interface RewrapResult {
  /** Keys re-wrapped by this run. */
  rewrapped: number;
  /** Keys still under another KEK afterwards (0 means older KEKs can be retired). */
  remaining: number;
}

/**
 * KEK rotation: re-wrap every live DEK under `newKekId`, one workspace per transaction (the row is
 * locked while it changes). The DEKs themselves, and so every object and field, stay the same.
 * Resumable and idempotent; destroyed keys are skipped. When `remaining` is 0, drop the old KEKs
 * from the provider's rotation list.
 */
export async function rewrapAll(
  db: Queryable,
  provider: KeyProvider,
  newKekId: string,
): Promise<RewrapResult> {
  if (!provider.has(newKekId)) throw new StorageCryptoError('UNKNOWN_KEK', 'KEK is not available');
  let rewrapped = 0;
  for (const workspaceId of await pendingRewrap(db, newKekId)) {
    const changed = await withWorkspace(db, { workspaceId }, async (tx) => {
      const row = await readKey(tx, workspaceId, true);
      if (row === null || row.destroyedAt !== null || row.kekId === newKekId) return false;
      const dek = await unwrapDek(provider, row.kekId, row.wrappedDek, workspaceId);
      const wrappedDek = await wrapDek(provider, newKekId, dek, workspaceId);
      await tx
        .update(workspaceKey)
        .set({ wrappedDek, kekId: newKekId })
        .where(eq(workspaceKey.workspaceId, workspaceId));
      return true;
    });
    if (changed) rewrapped += 1;
  }
  return { rewrapped, remaining: (await pendingRewrap(db, newKekId)).length };
}

/** Encrypt `source` for `workspaceId` with its DEK (created on first use). */
export async function encryptForWorkspace(
  db: Queryable,
  provider: KeyProvider,
  workspaceId: string,
  source: ByteSource,
  options: Pick<EncryptOptions, 'chunkSize'> = {},
): Promise<AsyncGenerator<Buffer, void, undefined>> {
  const { kekId } = await ensureWorkspaceKey(db, provider, workspaceId);
  const dek = await getWorkspaceDek(db, provider, workspaceId);
  return encryptStream(source, { ...options, dek, workspaceId, kekId });
}

/**
 * Decrypt an object of `workspaceId`. The DEK comes from `workspace_key`, so this fails with
 * `KEY_DESTROYED` after crypto-erase and keeps working across KEK rotation.
 */
export function decryptForWorkspace(
  db: Queryable,
  provider: KeyProvider,
  workspaceId: string,
  source: ByteSource,
): AsyncGenerator<Buffer, void, undefined> {
  return decryptStream(source, {
    workspaceId,
    resolveDek: () => getWorkspaceDek(db, provider, workspaceId),
  });
}
