// WebCrypto for the outbox (#50): AES-GCM with a non-extractable device key kept in IndexedDB. The
// limits are honest: the key is bound to this browser profile, which stops a copied database or a
// backup from being read, but it is not a substitute for the device lock. No credential, session
// token or key material is ever written to the outbox rows.
import type { KeyStore } from './db.ts';

export interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  encryptedBlob: ArrayBuffer;
}

/** The device key, created (non-extractable) on first use. */
export async function getDeviceKey(store: KeyStore): Promise<CryptoKey> {
  const existing = await store.get();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await store.put(key);
  return key;
}

/** Encrypt with a fresh 96-bit IV; never reuse an IV under one key. */
export async function encryptBytes(key: CryptoKey, data: ArrayBuffer): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBlob = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv, encryptedBlob };
}

export function decryptBytes(key: CryptoKey, sealed: Sealed): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.encryptedBlob);
}

/** Lowercase hex sha256, the idempotency key the capture API dedupes on. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
