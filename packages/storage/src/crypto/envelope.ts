// Streaming envelope encryption, format v1 (#216; spec in docs/engineering/storage.md).
//
//   header  = "CDE1" | version 0x01 | u8 kek-id length | kek id (UTF-8) | 16-byte workspace id
//             (the wrapped-DEK reference: `workspace_key` is keyed by workspace) | 12-byte base
//             nonce | u32 BE chunk size
//   chunk i = AES-256-GCM(DEK, nonce = base nonce XOR i, AAD = SHA-256(header) | u32 BE i |
//             final flag) → ciphertext | 16-byte tag
//
// Every chunk but the last carries exactly `chunk size` bytes of plaintext; the last carries 0 to
// `chunk size` bytes and the final flag, so dropping, appending, reordering or splicing chunks fails
// authentication, as does any change to the header (it is hashed into every chunk's AAD). The kek
// id in the header is informational: readers get the DEK from `workspace_key`, so rotating the KEK
// never rewrites objects. Plaintext is processed one chunk at a time; memory stays at a few chunks
// whatever the object size.
import { createHash, randomBytes } from 'node:crypto';

import type { Secret } from '@causedeck/config/env';

import { NONCE_BYTES, open, seal, TAG_BYTES } from './aead.ts';
import { StorageCryptoError } from './errors.ts';

export const ENVELOPE_MAGIC = 'CDE1';
export const ENVELOPE_VERSION = 1;
export const DEFAULT_CHUNK_SIZE = 64 * 1024;
export const MIN_CHUNK_SIZE = 16;
export const MAX_CHUNK_SIZE = 4 * 1024 * 1024;

const MAGIC = Buffer.from(ENVELOPE_MAGIC, 'ascii');
const WORKSPACE_REF_BYTES = 16;
const MAX_KEK_ID_BYTES = 64;
const MAX_CHUNKS = 0xffff_ffff;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EnvelopeHeader {
  version: number;
  /** The KEK the DEK was wrapped with when the object was written (informational). */
  kekId: string;
  /** The workspace whose DEK encrypts the object (lower-case uuid). */
  workspaceId: string;
  baseNonce: Buffer;
  chunkSize: number;
  /** The header bytes exactly as stored (store them with the object, e.g. `blob.enc_header`). */
  bytes: Buffer;
}

export interface EncryptOptions {
  dek: Secret<Buffer>;
  workspaceId: string;
  kekId: string;
  /** Plaintext bytes per chunk; 64 KiB unless a test needs small chunks. */
  chunkSize?: number | undefined;
}

export interface DecryptOptions {
  /** The DEK for the object's workspace, normally from `workspace_key` (never from the header). */
  resolveDek: (header: EnvelopeHeader) => Secret<Buffer> | Promise<Secret<Buffer>>;
  /** When set, an object written for another workspace is rejected before any key lookup. */
  workspaceId?: string | undefined;
}

export type ByteSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

function badFormat(message: string): StorageCryptoError {
  return new StorageCryptoError('BAD_FORMAT', message);
}

function uuidBytes(workspaceId: string): Buffer {
  if (!UUID.test(workspaceId)) throw badFormat('workspace id must be a uuid');
  return Buffer.from(workspaceId.replaceAll('-', ''), 'hex');
}

function uuidString(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function checkChunkSize(chunkSize: number): void {
  if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) {
    throw badFormat('chunk size is out of range');
  }
}

/** Serialise a v1 header. */
export function encodeHeader(fields: {
  kekId: string;
  workspaceId: string;
  baseNonce: Buffer;
  chunkSize: number;
}): Buffer {
  const kekId = Buffer.from(fields.kekId, 'utf8');
  if (kekId.length === 0 || kekId.length > MAX_KEK_ID_BYTES) throw badFormat('invalid kek id');
  if (fields.baseNonce.length !== NONCE_BYTES) throw badFormat('base nonce must be 12 bytes');
  checkChunkSize(fields.chunkSize);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(fields.chunkSize);
  return Buffer.concat([
    MAGIC,
    Buffer.from([ENVELOPE_VERSION, kekId.length]),
    kekId,
    uuidBytes(fields.workspaceId),
    fields.baseNonce,
    size,
  ]);
}

/**
 * Parse a v1 header from the start of `bytes`. Returns null when more bytes are needed; throws
 * `BAD_FORMAT` when what is there cannot be a v1 header.
 */
export function parseHeader(bytes: Buffer): EnvelopeHeader | null {
  if (bytes.length < MAGIC.length + 2) {
    if (!MAGIC.subarray(0, bytes.length).equals(bytes.subarray(0, MAGIC.length))) {
      throw badFormat('not an encrypted object (bad magic)');
    }
    return null;
  }
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw badFormat('not an encrypted object (bad magic)');
  }
  const version = bytes[4] ?? 0;
  if (version !== ENVELOPE_VERSION) throw badFormat('unsupported encryption format version');
  const kekIdLength = bytes[5] ?? 0;
  if (kekIdLength === 0 || kekIdLength > MAX_KEK_ID_BYTES) throw badFormat('invalid kek id');
  const length = 6 + kekIdLength + WORKSPACE_REF_BYTES + NONCE_BYTES + 4;
  if (bytes.length < length) return null;
  let at = 6;
  const kekId = bytes.subarray(at, (at += kekIdLength)).toString('utf8');
  const workspaceId = uuidString(bytes.subarray(at, (at += WORKSPACE_REF_BYTES)));
  const baseNonce = Buffer.from(bytes.subarray(at, (at += NONCE_BYTES)));
  const chunkSize = bytes.readUInt32BE(at);
  checkChunkSize(chunkSize);
  return {
    version,
    kekId,
    workspaceId,
    baseNonce,
    chunkSize,
    bytes: Buffer.from(bytes.subarray(0, length)),
  };
}

function chunkNonce(baseNonce: Buffer, index: number): Buffer {
  const nonce = Buffer.from(baseNonce);
  const at = NONCE_BYTES - 4;
  nonce.writeUInt32BE((nonce.readUInt32BE(at) ^ index) >>> 0, at);
  return nonce;
}

function chunkAad(headerHash: Buffer, index: number, final: boolean): Buffer {
  const aad = Buffer.alloc(headerHash.length + 5);
  headerHash.copy(aad, 0);
  aad.writeUInt32BE(index, headerHash.length);
  aad[headerHash.length + 4] = final ? 1 : 0;
  return aad;
}

/** A FIFO of byte slices that hands out exact lengths without re-copying the whole backlog. */
class ByteQueue {
  #parts: Buffer[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.#parts.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.length += bytes.length;
  }

  /** The first `n` bytes without removing them (n <= length). */
  peek(n: number): Buffer {
    const out: Buffer[] = [];
    let need = n;
    for (const part of this.#parts) {
      if (need === 0) break;
      const piece = part.subarray(0, need);
      out.push(piece);
      need -= piece.length;
    }
    return out.length === 1 ? (out[0] as Buffer) : Buffer.concat(out, n);
  }

  /** Remove and return the first `n` bytes (n <= length) as one buffer. */
  take(n: number): Buffer {
    const out = Buffer.allocUnsafe(n);
    let filled = 0;
    while (filled < n) {
      const part = this.#parts[0] as Buffer;
      const count = Math.min(part.length, n - filled);
      part.copy(out, filled, 0, count);
      filled += count;
      if (count === part.length) this.#parts.shift();
      else this.#parts[0] = part.subarray(count);
    }
    this.length -= n;
    return out;
  }
}

/** Encrypt `source` for `workspaceId` with its DEK: yields the header, then each sealed chunk. */
export async function* encryptStream(
  source: ByteSource,
  { dek, workspaceId, kekId, chunkSize = DEFAULT_CHUNK_SIZE }: EncryptOptions,
): AsyncGenerator<Buffer, void, undefined> {
  const header = encodeHeader({
    kekId,
    workspaceId,
    baseNonce: randomBytes(NONCE_BYTES),
    chunkSize,
  });
  const baseNonce = header.subarray(header.length - 4 - NONCE_BYTES, header.length - 4);
  const headerHash = createHash('sha256').update(header).digest();
  const key = dek.reveal();
  yield header;

  const queue = new ByteQueue();
  let index = 0;
  const sealChunk = (plaintext: Buffer, final: boolean): Buffer => {
    if (index > MAX_CHUNKS) throw badFormat('object has too many chunks');
    const sealed = seal(
      key,
      chunkNonce(baseNonce, index),
      plaintext,
      chunkAad(headerHash, index, final),
    );
    index += 1;
    return sealed;
  };

  for await (const piece of source) {
    queue.push(piece);
    // Keep at least one byte (or a whole chunk) back: the last chunk must carry the final flag.
    while (queue.length > chunkSize) yield sealChunk(queue.take(chunkSize), false);
  }
  yield sealChunk(queue.take(queue.length), true);
}

/**
 * Decrypt a v1 stream. Throws `BAD_FORMAT` for a malformed header and `AUTH_FAILED` for any
 * tampering, truncation, extension, reordering or wrong key; plaintext is yielded only after its
 * chunk authenticates.
 */
export async function* decryptStream(
  source: ByteSource,
  { resolveDek, workspaceId }: DecryptOptions,
): AsyncGenerator<Buffer, void, undefined> {
  const queue = new ByteQueue();
  let header: EnvelopeHeader | null = null;
  let key: Buffer | undefined;
  let headerHash: Buffer | undefined;
  let index = 0;

  const openChunk = (sealed: Buffer, final: boolean): Buffer => {
    if (header === null || key === undefined || headerHash === undefined) {
      throw badFormat('missing header');
    }
    if (index > MAX_CHUNKS) throw new StorageCryptoError('AUTH_FAILED', 'too many chunks');
    const plaintext = open(
      key,
      chunkNonce(header.baseNonce, index),
      sealed,
      chunkAad(headerHash, index, final),
    );
    index += 1;
    return plaintext;
  };

  for await (const piece of source) {
    queue.push(piece);
    if (header === null) {
      header = parseHeader(queue.peek(queue.length));
      if (header === null) continue;
      queue.take(header.bytes.length);
      if (workspaceId !== undefined && workspaceId.toLowerCase() !== header.workspaceId) {
        throw new StorageCryptoError('AUTH_FAILED', 'object belongs to another workspace');
      }
      headerHash = createHash('sha256').update(header.bytes).digest();
      key = (await resolveDek(header)).reveal();
    }
    const sealedSize = header.chunkSize + TAG_BYTES;
    while (queue.length > sealedSize) yield openChunk(queue.take(sealedSize), false);
  }
  if (header === null) throw badFormat('truncated header');
  if (queue.length < TAG_BYTES) {
    throw new StorageCryptoError('AUTH_FAILED', 'stream ended before its final chunk');
  }
  yield openChunk(queue.take(queue.length), true);
}
