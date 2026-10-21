// AES-256-GCM primitives shared by key wrapping, streaming and field encryption. A failed tag check
// becomes `AUTH_FAILED` without the OpenSSL error attached.
import { createCipheriv, createDecipheriv } from 'node:crypto';

import { StorageCryptoError } from './errors.ts';

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

/** AES-256-GCM: returns ciphertext ‖ tag. */
export function seal(key: Buffer, nonce: Buffer, plaintext: Uint8Array, aad: Uint8Array): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** Inverse of `seal`: `sealed` is ciphertext ‖ tag. Throws `AUTH_FAILED` on any mismatch. */
export function open(key: Buffer, nonce: Buffer, sealed: Uint8Array, aad: Uint8Array): Buffer {
  if (sealed.length < TAG_BYTES) {
    throw new StorageCryptoError('AUTH_FAILED', 'ciphertext is too short to authenticate');
  }
  const body = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new StorageCryptoError('AUTH_FAILED', 'decryption failed authentication');
  }
}
