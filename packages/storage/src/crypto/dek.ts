// Data-encryption keys (#216): one random 32-byte DEK per workspace, wrapped under a KEK with the
// workspace id as AAD, so a wrapped DEK copied to another workspace's row fails to unwrap.
import { randomBytes } from 'node:crypto';

import { Secret } from '@causedeck/config/env';

import { KEY_BYTES } from './aead.ts';
import type { KeyProvider } from './kek.ts';

export function generateDek(): Secret<Buffer> {
  return new Secret(randomBytes(KEY_BYTES));
}

export function wrapDek(
  provider: KeyProvider,
  kekId: string,
  dek: Secret<Buffer>,
  workspaceId: string,
): Promise<Buffer> {
  return provider.wrap(kekId, dek, workspaceId.toLowerCase());
}

export function unwrapDek(
  provider: KeyProvider,
  kekId: string,
  wrapped: Buffer,
  workspaceId: string,
): Promise<Secret<Buffer>> {
  return provider.unwrap(kekId, wrapped, workspaceId.toLowerCase());
}
