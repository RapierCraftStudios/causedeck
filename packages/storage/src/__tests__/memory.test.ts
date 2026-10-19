import { describe, expect, it } from 'vitest';

import { storageReadyCheck } from '../health.ts';
import { createMemoryObjectStore, type MemoryObjectStore } from '../memory-provider.ts';
import { StorageError } from '../provider.ts';

import { objectStoreContract } from './object-store.contract.ts';

const status = (error: unknown) => (error instanceof StorageError ? (error.status ?? 500) : 500);

let clock: Date | undefined;
let store: MemoryObjectStore = createMemoryObjectStore();

objectStoreContract('memory-provider', () => {
  clock = undefined;
  store = createMemoryObjectStore({ now: () => clock ?? new Date() });
  return {
    store,
    setNow: (now) => {
      clock = now;
    },
    upload: (url, body, contentType) =>
      store.upload(url, { body, contentType }).then(
        () => 200,
        (error: unknown) => status(error),
      ),
    download: (url) =>
      store.download(url).then(
        (body) => ({ status: 200, body }),
        (error: unknown) => ({ status: status(error) }),
      ),
  };
});

describe('memory-provider readiness', () => {
  it('storage check rejects when the bucket is unreachable', async () => {
    await expect(storageReadyCheck(createMemoryObjectStore())()).resolves.toBeUndefined();
    await expect(
      storageReadyCheck(createMemoryObjectStore({ unreachable: true }))(),
    ).rejects.toBeInstanceOf(StorageError);
  });
});
