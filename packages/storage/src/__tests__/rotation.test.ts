// KEK rotation (#216): `rewrapAll` re-wraps every live DEK under the new KEK without touching any
// object; reads work before, during (a partly rotated state) and after, and once it reports nothing
// remaining the old KEK can be dropped from the provider.
import { randomBytes } from 'node:crypto';

import { workspaceKey } from '@causedeck/db/schema';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { Transaction } from '@causedeck/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  decryptForWorkspace,
  destroyWorkspaceKey,
  encryptForWorkspace,
  EnvKeyProvider,
  getWorkspaceDek,
  pendingRewrap,
  rewrapAll,
  type Kek,
  type KeyProvider,
} from '../index.ts';

import { collect, newKek, newWorkspace, rejection } from './workspace-fixtures.ts';

const kek1 = newKek('kek-1');
const kek2 = newKek('kek-2');

async function keyRow(tx: Transaction, ws: string) {
  const [row] = await inWorkspace(tx, ws, (s) =>
    s.select().from(workspaceKey).where(eq(workspaceKey.workspaceId, ws)),
  );
  if (row === undefined) throw new Error('no key row');
  return row;
}

/** A provider that fails the n-th wrap, to leave a rotation half done. */
function failingAfter(keks: readonly Kek[], wraps: number): KeyProvider {
  const inner = new EnvKeyProvider(keks);
  let count = 0;
  return {
    currentKekId: () => inner.currentKekId(),
    has: (id) => inner.has(id),
    unwrap: (id, wrapped, aad) => inner.unwrap(id, wrapped, aad),
    wrap: (id, dek, aad) => {
      count += 1;
      if (count > wraps) return Promise.reject(new Error('KMS unavailable'));
      return inner.wrap(id, dek, aad);
    },
  };
}

describe('KEK rotation', () => {
  it('re-wraps every DEK under the new KEK, objects unchanged, reads throughout', async () => {
    await withTestDb(async (tx) => {
      const old = new EnvKeyProvider([kek1]);
      const [w1, w2, w3] = [await newWorkspace(tx), await newWorkspace(tx), await newWorkspace(tx)];
      const workspaces = [w1, w2, w3];
      const plaintext = randomBytes(150_000);
      const objects = new Map<string, Buffer>();
      const deks = new Map<string, Buffer>();
      for (const ws of workspaces) {
        objects.set(ws, await collect(await encryptForWorkspace(tx, old, ws, [plaintext])));
        deks.set(ws, (await getWorkspaceDek(tx, old, ws)).reveal());
      }
      const stored = new Map([...objects].map(([ws, bytes]) => [ws, Buffer.from(bytes)]));
      const destroyed = await newWorkspace(tx);
      await destroyWorkspaceKey(tx, destroyed);

      const readAll = async (provider: KeyProvider) => {
        for (const ws of workspaces) {
          const out = await collect(
            decryptForWorkspace(tx, provider, ws, [objects.get(ws) ?? Buffer.alloc(0)]),
          );
          expect(out.equals(plaintext)).toBe(true);
        }
      };
      await readAll(old);

      // Rotation begins: kek-2 is current, kek-1 still held. A failure part-way leaves a mixed state.
      const rotating = [kek2, kek1];
      expect(
        (await rejection(rewrapAll(tx, failingAfter(rotating, 1), 'kek-2'))) instanceof Error,
      ).toBe(true);
      const kekIds: string[] = [];
      for (const ws of workspaces) kekIds.push((await keyRow(tx, ws)).kekId);
      expect(kekIds.sort()).toEqual(['kek-1', 'kek-1', 'kek-2']);
      await readAll(new EnvKeyProvider(rotating));
      expect(
        (await pendingRewrap(tx, 'kek-2')).filter((ws) => workspaces.includes(ws)),
      ).toHaveLength(2);

      // Resume: only the rest is re-wrapped; a rerun is a no-op.
      const both = new EnvKeyProvider(rotating);
      expect(await rewrapAll(tx, both, 'kek-2')).toEqual({ rewrapped: 2, remaining: 0 });
      expect(await rewrapAll(tx, both, 'kek-2')).toEqual({ rewrapped: 0, remaining: 0 });
      for (const ws of workspaces) expect((await keyRow(tx, ws)).kekId).toBe('kek-2');
      // The destroyed key is skipped and stays zeroed.
      const tomb = await keyRow(tx, destroyed);
      expect(tomb.destroyedAt).not.toBeNull();
      expect(tomb.wrappedDek.every((b) => b === 0)).toBe(true);

      // kek-1 retired: a provider with only kek-2 reads every object, with the same DEKs.
      const retired = new EnvKeyProvider([kek2]);
      await readAll(retired);
      for (const ws of workspaces) {
        expect((await getWorkspaceDek(tx, retired, ws)).reveal()).toEqual(deks.get(ws));
        expect(objects.get(ws)?.equals(stored.get(ws) ?? Buffer.alloc(0))).toBe(true);
      }
      // ...while kek-1 alone no longer can.
      expect((await rejection(getWorkspaceDek(tx, old, w1))).code).toBe('UNKNOWN_KEK');
    });
  });

  it('refuses a KEK the provider does not hold', async () => {
    await withTestDb(async (tx) => {
      const err = await rejection(rewrapAll(tx, new EnvKeyProvider([kek1]), 'kek-2'));
      expect(err.code).toBe('UNKNOWN_KEK');
    });
  });
});
