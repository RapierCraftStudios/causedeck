// WebCrypto for the offline cache (#65, ADR-0042). Court days and briefs hold party names, so every
// payload is AES-GCM sealed under a random data key. The data key is stored only wrapped, by a key
// derived (HKDF) from a secret that exists for the signed-in session. Destroying the wrapped key
// (sign-out, workspace switch, "clear") makes the cached rows unreadable even if the rows linger.
// This is separate from the outbox device key in `lib/pwa/outbox/crypto.ts`, which must outlive
// sign-out so queued captures are not lost.

export interface SealedPayload {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

/** The wrapped data key as persisted in the `meta` store. Never holds raw key material. */
export interface WrappedKey {
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  wrapped: ArrayBuffer;
}

/** Reads and writes the wrapped key; `db.ts` backs it with the `meta` store. */
export interface WrappedKeyStore {
  get(): Promise<WrappedKey | undefined>;
  put(value: WrappedKey): Promise<void>;
  remove(): Promise<void>;
}

export interface Vault {
  seal(value: unknown): Promise<SealedPayload>;
  open<T = unknown>(sealed: SealedPayload): Promise<T>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HKDF_INFO = encoder.encode('causedeck-offline-wrap-v1');

async function wrappingKey(
  sessionSecret: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sessionSecret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

const DATA_KEY_ALGORITHM = { name: 'AES-GCM', length: 256 } as const;

/**
 * The data key for this session: unwrapped from the store when present, else created, wrapped and
 * stored. It is imported non-extractable, so script cannot read it back out. A wrong session
 * secret (a different sign-in) fails to unwrap and rejects; callers treat that as "no cache".
 */
export async function openVault(store: WrappedKeyStore, sessionSecret: string): Promise<Vault> {
  const existing = await store.get();
  let key: CryptoKey;
  if (existing) {
    key = await crypto.subtle.unwrapKey(
      'raw',
      existing.wrapped,
      await wrappingKey(sessionSecret, existing.salt),
      { name: 'AES-GCM', iv: existing.iv },
      DATA_KEY_ALGORITHM,
      false,
      ['encrypt', 'decrypt'],
    );
  } else {
    const fresh = await crypto.subtle.generateKey(DATA_KEY_ALGORITHM, true, ['encrypt', 'decrypt']);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.wrapKey(
      'raw',
      fresh,
      await wrappingKey(sessionSecret, salt),
      { name: 'AES-GCM', iv },
    );
    await store.put({ salt, iv, wrapped });
    key = await crypto.subtle.unwrapKey(
      'raw',
      wrapped,
      await wrappingKey(sessionSecret, salt),
      { name: 'AES-GCM', iv },
      DATA_KEY_ALGORITHM,
      false,
      ['encrypt', 'decrypt'],
    );
  }
  return {
    async seal(value) {
      // A fresh 96-bit IV for every payload; never reuse an IV under one key.
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(JSON.stringify(value)),
      );
      return { iv, data };
    },
    async open<T>(sealed: SealedPayload) {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.iv },
        key,
        sealed.data,
      );
      return JSON.parse(decoder.decode(plain)) as T;
    },
  };
}

/** Drop the wrapped key: the sealed rows can no longer be read by anyone. */
export function destroyKey(store: WrappedKeyStore): Promise<void> {
  return store.remove();
}
