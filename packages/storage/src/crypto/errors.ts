// Errors from the storage crypto layer (#216). Messages are fixed strings: they never carry key
// bytes, wrapped DEKs, plaintext or the underlying OpenSSL error (which is dropped, not chained as
// `cause`), so logging an error cannot leak key material.

export type StorageCryptoErrorCode =
  /** The workspace key was crypto-erased (`destroyWorkspaceKey`); its data is gone for good. */
  | 'KEY_DESTROYED'
  /** An AES-GCM tag did not verify: tampered, truncated, reordered or the wrong key. */
  | 'AUTH_FAILED'
  /** The key provider does not hold the named KEK. */
  | 'UNKNOWN_KEK'
  /** The workspace has no key yet (`ensureWorkspaceKey` was never called). */
  | 'NO_WORKSPACE_KEY'
  /** Malformed input: bad magic, version, chunk size, field encoding or key length. */
  | 'BAD_FORMAT'
  /** A provider that is a stub (Stage B KMS). */
  | 'NOT_IMPLEMENTED';

export class StorageCryptoError extends Error {
  readonly code: StorageCryptoErrorCode;

  constructor(code: StorageCryptoErrorCode, message: string) {
    super(message);
    this.name = 'StorageCryptoError';
    this.code = code;
  }
}

export function isStorageCryptoError(
  error: unknown,
  code?: StorageCryptoErrorCode,
): error is StorageCryptoError {
  return error instanceof StorageCryptoError && (code === undefined || error.code === code);
}
