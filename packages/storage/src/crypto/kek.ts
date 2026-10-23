// Key-encryption keys (#216, docs/engineering/storage.md). A `KeyProvider` wraps and unwraps
// workspace DEKs under a named KEK with AES-256-GCM (AAD = workspace id). `EnvKeyProvider` holds a
// rotation list of KEKs in process memory, the first being current; `KEK_BASE64` from the env
// schema is `kek-1`. `KmsKeyProvider` is the Stage B seam and is not implemented yet.
import { randomBytes } from 'node:crypto';

import { Secret } from '@causedeck/config/env';

import { KEY_BYTES, NONCE_BYTES, open, seal } from './aead.ts';
import { StorageCryptoError } from './errors.ts';

/** The id `KEK_BASE64` is known by. */
export const ENV_KEK_ID = 'kek-1';

const KEK_ID = /^[A-Za-z0-9._-]{1,64}$/;

export interface Kek {
  id: string;
  key: Secret<Buffer>;
}

export interface KeyProvider {
  /** The KEK new DEKs are wrapped with. */
  currentKekId(): string;
  /** Whether this provider can wrap or unwrap under `kekId`. */
  has(kekId: string): boolean;
  /** Wrap `dek` under `kekId`, bound to `aad` (the workspace id). */
  wrap(kekId: string, dek: Secret<Buffer>, aad: string): Promise<Buffer>;
  /** Unwrap a DEK wrapped under `kekId` for `aad`; `AUTH_FAILED` when anything differs. */
  unwrap(kekId: string, wrapped: Buffer, aad: string): Promise<Secret<Buffer>>;
}

/** Build a KEK from base64 of exactly 32 bytes. */
export function kekFromBase64(id: string, base64: Secret | string): Kek {
  const raw = Buffer.from(typeof base64 === 'string' ? base64 : base64.reveal(), 'base64');
  return { id, key: new Secret(raw) };
}

/**
 * KEKs held in process memory: `keks[0]` is current; the rest are older KEKs kept so DEKs not yet
 * re-wrapped (`rewrapAll`) can still be read. Retire an old KEK by dropping it from the list once
 * no workspace key references it.
 */
export class EnvKeyProvider implements KeyProvider {
  readonly #keks: ReadonlyMap<string, Secret<Buffer>>;
  readonly #current: string;

  constructor(keks: readonly Kek[]) {
    const [first] = keks;
    if (first === undefined) throw new StorageCryptoError('BAD_FORMAT', 'no KEK configured');
    const map = new Map<string, Secret<Buffer>>();
    for (const kek of keks) {
      if (!KEK_ID.test(kek.id)) throw new StorageCryptoError('BAD_FORMAT', 'invalid KEK id');
      if (map.has(kek.id)) throw new StorageCryptoError('BAD_FORMAT', 'duplicate KEK id');
      if (kek.key.reveal().length !== KEY_BYTES) {
        throw new StorageCryptoError('BAD_FORMAT', 'a KEK must be exactly 32 bytes');
      }
      map.set(kek.id, kek.key);
    }
    this.#keks = map;
    this.#current = first.id;
  }

  /** `KEK_BASE64` as `kek-1`, followed by any older KEKs still being rotated out. */
  static fromEnv(env: { KEK_BASE64: Secret }, previous: readonly Kek[] = []): EnvKeyProvider {
    return new EnvKeyProvider([kekFromBase64(ENV_KEK_ID, env.KEK_BASE64), ...previous]);
  }

  currentKekId(): string {
    return this.#current;
  }

  has(kekId: string): boolean {
    return this.#keks.has(kekId);
  }

  #key(kekId: string): Buffer {
    const key = this.#keks.get(kekId);
    if (key === undefined) throw new StorageCryptoError('UNKNOWN_KEK', 'KEK is not available');
    return key.reveal();
  }

  /** nonce ‖ ciphertext ‖ tag. */
  wrap(kekId: string, dek: Secret<Buffer>, aad: string): Promise<Buffer> {
    return settle(() => {
      const nonce = randomBytes(NONCE_BYTES);
      const sealed = seal(this.#key(kekId), nonce, dek.reveal(), Buffer.from(aad, 'utf8'));
      return Buffer.concat([nonce, sealed]);
    });
  }

  unwrap(kekId: string, wrapped: Buffer, aad: string): Promise<Secret<Buffer>> {
    return settle(() => {
      const key = this.#key(kekId);
      const nonce = wrapped.subarray(0, NONCE_BYTES);
      if (nonce.length !== NONCE_BYTES) {
        throw new StorageCryptoError('AUTH_FAILED', 'wrapped key is too short');
      }
      const dek = open(key, nonce, wrapped.subarray(NONCE_BYTES), Buffer.from(aad, 'utf8'));
      if (dek.length !== KEY_BYTES) {
        throw new StorageCryptoError('BAD_FORMAT', 'unwrapped key has the wrong length');
      }
      return new Secret(dek);
    });
  }

  toJSON(): string {
    return '[EnvKeyProvider]';
  }
}

/** Stage B: KEKs in AWS KMS (ap-south-1). Not implemented; every call throws `NOT_IMPLEMENTED`. */
export class KmsKeyProvider implements KeyProvider {
  readonly keyArn: string;

  constructor(options: { keyArn: string }) {
    this.keyArn = options.keyArn;
  }

  currentKekId(): string {
    throw notImplemented();
  }

  has(): boolean {
    throw notImplemented();
  }

  wrap(): Promise<Buffer> {
    return Promise.reject(notImplemented());
  }

  unwrap(): Promise<Secret<Buffer>> {
    return Promise.reject(notImplemented());
  }
}

/** Run `fn` so a throw becomes a rejection, as an async (KMS-backed) provider would behave. */
function settle<T>(fn: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(fn());
  });
}

function notImplemented(): StorageCryptoError {
  return new StorageCryptoError('NOT_IMPLEMENTED', 'KmsKeyProvider arrives in Stage B');
}
