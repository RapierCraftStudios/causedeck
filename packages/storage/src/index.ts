/**
 * S3 abstraction, server-side keys and signed URLs (#21 part 1, #215) and per-workspace envelope
 * encryption (#216). Uploads, downloads and the blob table arrive in #217.
 */
export const packageName: string = '@causedeck/storage';

export * from './health.ts';
export * from './keys.ts';
export * from './limits.ts';
export * from './memory-provider.ts';
export * from './provider.ts';
export * from './s3-provider.ts';

export { KEY_BYTES } from './crypto/aead.ts';
export { generateDek, unwrapDek, wrapDek } from './crypto/dek.ts';
export {
  decryptStream,
  DEFAULT_CHUNK_SIZE,
  encodeHeader,
  encryptStream,
  ENVELOPE_MAGIC,
  ENVELOPE_VERSION,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  parseHeader,
  type ByteSource,
  type DecryptOptions,
  type EncryptOptions,
  type EnvelopeHeader,
} from './crypto/envelope.ts';
export {
  isStorageCryptoError,
  StorageCryptoError,
  type StorageCryptoErrorCode,
} from './crypto/errors.ts';
export {
  ENV_KEK_ID,
  EnvKeyProvider,
  kekFromBase64,
  KmsKeyProvider,
  type Kek,
  type KeyProvider,
} from './crypto/kek.ts';
export { decryptField, encryptField, FIELD_PREFIX } from './field-crypto.ts';
export {
  decryptForWorkspace,
  DESTROYED_KEK_ID,
  destroyWorkspaceKey,
  encryptForWorkspace,
  ensureWorkspaceKey,
  getWorkspaceDek,
  pendingRewrap,
  rewrapAll,
  type EnsuredKey,
  type RewrapResult,
} from './workspace-crypto.ts';
