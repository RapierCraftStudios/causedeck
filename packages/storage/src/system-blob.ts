// Server-written objects (#255; docs/engineering/storage.md). Invoice PDFs and other files the
// platform generates itself never go through the upload intent: `storeSystemBlob` encrypts the
// bytes under the workspace DEK (envelope v1, DEK created on first use), puts the ciphertext at a
// server-built key and records a `blob` row that is already finalized: sha256 and size of the
// plaintext, the envelope header in `enc_header`, `scan_status = 'skipped'` (our own output is not
// virus-scanned) and `created_by` null (no uploading user). The row is written inside
// `withWorkspace`, so FORCE row-level security keeps it in its workspace. A failed insert deletes
// the object again.
import { createHash, randomUUID } from 'node:crypto';

import { withWorkspace, type Queryable } from '@causedeck/db';
import { blob } from '@causedeck/db/schema';

import type { KeyProvider } from './crypto/kek.ts';
import { objectKey, type ObjectKey } from './keys.ts';
import { assertWithinLimit, isObjectKind, type ObjectKind } from './limits.ts';
import type { ObjectStore } from './provider.ts';
import { encryptForWorkspace } from './workspace-crypto.ts';

export interface SystemBlobCtx {
  db: Queryable;
  store: ObjectStore;
  keys: KeyProvider;
  workspaceId: string;
  now?: () => Date;
}

export interface SystemBlobInput {
  kind: ObjectKind;
  /** A display name only: no path separators or control characters. */
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export interface StoredSystemBlob {
  blobId: string;
  key: ObjectKey;
}

/** Path separators and control characters (C0 and DEL). */
// eslint-disable-next-line no-control-regex
const BAD_FILENAME_CHARS = /[/\\\u0000-\u001f\u007f]/;

function checkName(kind: string, name: string): void {
  if (!isObjectKind(kind)) throw new TypeError('storeSystemBlob: unknown kind');
  if (name.length === 0 || name.length > 255 || BAD_FILENAME_CHARS.test(name)) {
    throw new TypeError('storeSystemBlob: invalid file name');
  }
}

function checkInput(input: SystemBlobInput): void {
  checkName(input.kind, input.filename);
  if (input.bytes.byteLength === 0) throw new TypeError('storeSystemBlob: empty object');
  assertWithinLimit(input.kind, input.bytes.byteLength);
}

async function collect(chunks: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
}

/** Encrypt and store a platform-generated object; returns the finalized blob's id and key. */
export async function storeSystemBlob(
  ctx: SystemBlobCtx,
  input: SystemBlobInput,
): Promise<StoredSystemBlob> {
  checkInput(input);
  const now = ctx.now?.() ?? new Date();
  const blobId = randomUUID();
  const key = objectKey({ workspaceId: ctx.workspaceId, kind: input.kind, id: blobId }, now);
  const plaintext = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  const sha256 = createHash('sha256').update(plaintext).digest('hex');

  // The first chunk is the envelope header (encryptStream), kept on the row for readers.
  const [header, ...sealed] = await collect(
    await encryptForWorkspace(ctx.db, ctx.keys, ctx.workspaceId, [plaintext]),
  );
  if (header === undefined) throw new Error('storeSystemBlob: encryption produced no header');
  await ctx.store.put({
    key,
    body: Buffer.concat([header, ...sealed]),
    contentType: 'application/octet-stream',
  });

  try {
    await withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, async (tx) => {
      await tx.insert(blob).values({
        id: blobId,
        workspaceId: ctx.workspaceId,
        key,
        kind: input.kind,
        filename: input.filename,
        size: plaintext.byteLength,
        sha256,
        mime: input.mime,
        encHeader: header,
        scanStatus: 'skipped',
        createdBy: null,
        createdAt: now,
        finalizedAt: now,
      });
    });
  } catch (error) {
    await ctx.store.delete(key).catch(() => undefined);
    throw error;
  }
  return { blobId, key };
}

export interface SystemBlobStreamInput {
  kind: ObjectKind;
  /** A display name only: no path separators or control characters. */
  filename: string;
  mime: string;
  /** Plaintext, consumed once; never held whole. */
  body: AsyncIterable<Uint8Array>;
}

export interface StoredSystemBlobStream extends StoredSystemBlob {
  /** Plaintext bytes. */
  size: number;
  /** Hex sha256 of the plaintext. */
  sha256: string;
}

/**
 * `storeSystemBlob` for large objects (#301, workspace exports): the plaintext streams through the
 * sha256, the workspace envelope encryption and a multipart `putStream`, so memory stays bounded.
 * The finalized `blob` row is written after the upload; a failure deletes the object again.
 */
export async function storeSystemBlobStream(
  ctx: SystemBlobCtx,
  input: SystemBlobStreamInput,
): Promise<StoredSystemBlobStream> {
  checkName(input.kind, input.filename);
  const now = ctx.now?.() ?? new Date();
  const blobId = randomUUID();
  const key = objectKey({ workspaceId: ctx.workspaceId, kind: input.kind, id: blobId }, now);
  const hash = createHash('sha256');
  let size = 0;
  async function* plaintext(): AsyncGenerator<Uint8Array, void, undefined> {
    for await (const chunk of input.body) {
      hash.update(chunk);
      size += chunk.byteLength;
      yield chunk;
    }
  }
  let header: Buffer | undefined;
  const sealed = await encryptForWorkspace(ctx.db, ctx.keys, ctx.workspaceId, plaintext());
  async function* ciphertext(): AsyncGenerator<Uint8Array, void, undefined> {
    for await (const chunk of sealed) {
      // The first chunk is the envelope header (encryptStream), kept on the row for readers.
      header ??= chunk;
      yield chunk;
    }
  }

  try {
    await ctx.store.putStream({
      key,
      body: ciphertext(),
      contentType: 'application/octet-stream',
    });
    if (header === undefined) throw new Error('storeSystemBlobStream: no envelope header');
    if (size === 0) throw new TypeError('storeSystemBlobStream: empty object');
    const sha256 = hash.digest('hex');
    const encHeader = header;
    await withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, async (tx) => {
      await tx.insert(blob).values({
        id: blobId,
        workspaceId: ctx.workspaceId,
        key,
        kind: input.kind,
        filename: input.filename,
        size,
        sha256,
        mime: input.mime,
        encHeader,
        scanStatus: 'skipped',
        createdBy: null,
        createdAt: now,
        finalizedAt: now,
      });
    });
    return { blobId, key, size, sha256 };
  } catch (error) {
    await ctx.store.delete(key).catch(() => undefined);
    throw error;
  }
}
