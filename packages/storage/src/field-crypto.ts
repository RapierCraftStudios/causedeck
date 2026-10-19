// Field encryption with the workspace DEK (#216), for small values stored in Postgres such as
// `packages/core` memory values. Format: `f1.` + base64url(12-byte nonce | ciphertext | tag), with
// AES-256-GCM and AAD = workspace id, so a value copied into another workspace does not decrypt.
import { randomBytes } from 'node:crypto';

import type { Secret } from '@causedeck/config/env';

import { NONCE_BYTES, open, seal, TAG_BYTES } from './crypto/aead.ts';
import { StorageCryptoError } from './crypto/errors.ts';

export const FIELD_PREFIX = 'f1.';

const BASE64URL = /^[A-Za-z0-9_-]*$/;

function aad(workspaceId: string): Buffer {
  return Buffer.from(`field:${workspaceId.toLowerCase()}`, 'utf8');
}

export function encryptField(dek: Secret<Buffer>, workspaceId: string, plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = seal(dek.reveal(), nonce, Buffer.from(plaintext, 'utf8'), aad(workspaceId));
  return FIELD_PREFIX + Buffer.concat([nonce, sealed]).toString('base64url');
}

export function decryptField(dek: Secret<Buffer>, workspaceId: string, value: string): string {
  const body = value.startsWith(FIELD_PREFIX) ? value.slice(FIELD_PREFIX.length) : null;
  if (body === null || !BASE64URL.test(body)) {
    throw new StorageCryptoError('BAD_FORMAT', 'not an encrypted field');
  }
  const bytes = Buffer.from(body, 'base64url');
  if (bytes.length < NONCE_BYTES + TAG_BYTES) {
    throw new StorageCryptoError('BAD_FORMAT', 'encrypted field is too short');
  }
  const plaintext = open(
    dek.reveal(),
    bytes.subarray(0, NONCE_BYTES),
    bytes.subarray(NONCE_BYTES),
    aad(workspaceId),
  );
  return plaintext.toString('utf8');
}
