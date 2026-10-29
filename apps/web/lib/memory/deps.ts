// The memory domain's dependencies for a workspace transaction (#73): the transaction and the
// workspace key provider that decrypts memory values. Server-only; the provider is built once.
import { EnvKeyProvider, type KeyProvider } from '@causedeck/storage';

import { serverEnv } from '../env.ts';

let keys: KeyProvider | undefined;

export function memoryDeps<Tx>(tx: Tx): { db: Tx; keys: KeyProvider } {
  return { db: tx, keys: (keys ??= EnvKeyProvider.fromEnv(serverEnv())) };
}
