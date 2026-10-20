// Crypto-erase (#216): `destroyWorkspaceKey` zeroes the wrapped DEK and marks it destroyed; every
// later read fails with KEY_DESTROYED and the ciphertext stays unreadable even with the KEK.
// Runs as causedeck_app in a rolled-back transaction, under FORCE row-level security.
import { randomBytes } from 'node:crypto';

import { deletionTombstone, workspaceKey } from '@causedeck/db/schema';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  decryptForWorkspace,
  destroyWorkspaceKey,
  encryptForWorkspace,
  ensureWorkspaceKey,
  EnvKeyProvider,
  getWorkspaceDek,
  unwrapDek,
} from '../index.ts';

import { collect, newKek, newWorkspace, rejection } from './workspace-fixtures.ts';

const provider = new EnvKeyProvider([newKek('kek-1')]);

describe('workspace keys and crypto-erase', () => {
  it('ensureWorkspaceKey creates one wrapped DEK per workspace, idempotently', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      expect(await ensureWorkspaceKey(tx, provider, ws)).toEqual({ kekId: 'kek-1', created: true });
      expect(await ensureWorkspaceKey(tx, provider, ws)).toEqual({
        kekId: 'kek-1',
        created: false,
      });
      const rows = await inWorkspace(tx, ws, (s) =>
        s.select().from(workspaceKey).where(eq(workspaceKey.workspaceId, ws)),
      );
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row?.wrappedDek).toHaveLength(60);
      expect(row?.destroyedAt).toBeNull();
      // The stored bytes are the DEK wrapped under the KEK with AAD = workspace id.
      const dek = await getWorkspaceDek(tx, provider, ws);
      if (row === undefined) throw new Error('no row');
      expect((await unwrapDek(provider, 'kek-1', row.wrappedDek, ws)).reveal()).toEqual(
        dek.reveal(),
      );
    });
  });

  it('reads before a key exists fail with NO_WORKSPACE_KEY', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      expect((await rejection(getWorkspaceDek(tx, provider, ws))).code).toBe('NO_WORKSPACE_KEY');
    });
  });

  it('after destroyWorkspaceKey the row is zeroed, reads fail and the KEK cannot help', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const other = await newWorkspace(tx);
      const plaintext = randomBytes(200_000);
      const ciphertext = await collect(await encryptForWorkspace(tx, provider, ws, [plaintext]));
      const otherCiphertext = await collect(
        await encryptForWorkspace(tx, provider, other, [plaintext]),
      );
      expect(
        (await collect(decryptForWorkspace(tx, provider, ws, [ciphertext]))).equals(plaintext),
      ).toBe(true);
      const before = await inWorkspace(tx, ws, (s) =>
        s.select().from(workspaceKey).where(eq(workspaceKey.workspaceId, ws)),
      );

      expect(await destroyWorkspaceKey(tx, ws)).toEqual({ destroyed: true });
      expect(await destroyWorkspaceKey(tx, ws)).toEqual({ destroyed: true });

      const [row] = await inWorkspace(tx, ws, (s) =>
        s.select().from(workspaceKey).where(eq(workspaceKey.workspaceId, ws)),
      );
      if (row === undefined) throw new Error('the row must stay as a tombstone');
      expect(row.destroyedAt).toBeInstanceOf(Date);
      expect(row.wrappedDek).toHaveLength(before[0]?.wrappedDek.length ?? -1);
      expect(row.wrappedDek.every((b) => b === 0)).toBe(true);

      expect((await rejection(getWorkspaceDek(tx, provider, ws))).code).toBe('KEY_DESTROYED');
      expect(
        (await rejection(collect(decryptForWorkspace(tx, provider, ws, [ciphertext])))).code,
      ).toBe('KEY_DESTROYED');
      expect((await rejection(ensureWorkspaceKey(tx, provider, ws))).code).toBe('KEY_DESTROYED');
      expect((await rejection(encryptForWorkspace(tx, provider, ws, [plaintext]))).code).toBe(
        'KEY_DESTROYED',
      );
      // Even holding the KEK, the zeroed row yields no DEK.
      expect((await rejection(unwrapDek(provider, row.kekId, row.wrappedDek, ws))).code).toBe(
        'AUTH_FAILED',
      );

      // The other workspace is untouched.
      expect(
        (await collect(decryptForWorkspace(tx, provider, other, [otherCiphertext]))).equals(
          plaintext,
        ),
      ).toBe(true);
    });
  });

  it('erasing a workspace that never had a key leaves a tombstone that blocks a new key', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await destroyWorkspaceKey(tx, ws);
      expect((await rejection(ensureWorkspaceKey(tx, provider, ws))).code).toBe('KEY_DESTROYED');
      expect((await rejection(getWorkspaceDek(tx, provider, ws))).code).toBe('KEY_DESTROYED');
    });
  });

  it('after workspace deletion purges the key row, the tombstone keeps reads at KEY_DESTROYED (#302)', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const plaintext = randomBytes(1_000);
      const ciphertext = await collect(await encryptForWorkspace(tx, provider, ws, [plaintext]));
      await destroyWorkspaceKey(tx, ws);
      await tx.insert(deletionTombstone).values({ workspaceId: ws, receiptHash: 'ab'.repeat(32) });
      await inWorkspace(tx, ws, (s) =>
        s.delete(workspaceKey).where(eq(workspaceKey.workspaceId, ws)),
      );

      expect((await rejection(getWorkspaceDek(tx, provider, ws))).code).toBe('KEY_DESTROYED');
      expect(
        (await rejection(collect(decryptForWorkspace(tx, provider, ws, [ciphertext])))).code,
      ).toBe('KEY_DESTROYED');
      expect((await rejection(ensureWorkspaceKey(tx, provider, ws))).code).toBe('KEY_DESTROYED');
      // A live workspace without a key (and without a tombstone) is still NO_WORKSPACE_KEY.
      const live = await newWorkspace(tx);
      expect((await rejection(getWorkspaceDek(tx, provider, live))).code).toBe('NO_WORKSPACE_KEY');
    });
  });

  it('a destroyed row cannot keep key bytes (check constraint)', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await ensureWorkspaceKey(tx, provider, ws);
      const failed = await rejection(
        inWorkspace(tx, ws, (s) =>
          s.execute(sql`update workspace_key set destroyed_at = now() where workspace_id = ${ws}`),
        ),
      );
      expect(JSON.stringify(failed)).toContain('23514');
    });
  });

  it("workspace B can neither see nor erase workspace A's key", async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      await ensureWorkspaceKey(tx, provider, a);
      await inWorkspace(tx, b, async (s) => {
        expect(await s.select().from(workspaceKey).where(eq(workspaceKey.workspaceId, a))).toEqual(
          [],
        );
        const erased = await s
          .update(workspaceKey)
          .set({ destroyedAt: new Date(), wrappedDek: Buffer.alloc(60) })
          .where(eq(workspaceKey.workspaceId, a))
          .returning();
        expect(erased).toEqual([]);
      });
      await getWorkspaceDek(tx, provider, a);
    });
  });
});
