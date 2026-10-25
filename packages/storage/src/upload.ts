// Workspace-scoped uploads (#217; docs/engineering/storage.md). Two steps, both inside
// `withWorkspace` so FORCE row-level security keeps every `blob` row in its own workspace:
//   createUploadIntent  check the kind, name, declared type and size against the allow-list and
//                       caps, record a `blob` row (open intent) and return a 5-minute presigned PUT
//                       bound to the server-built key, type and length
//   finalizeUpload      re-read the stored bytes, sniff their type, recompute sha256; reject (and
//                       delete) anything off the allow-list or not what was declared, else mark
//                       the row `scan_status = 'pending'` for the ClamAV worker
// Callers pass the checked identity in `StorageCtx`; `authorize` is the `assertCan` seam.
import { createHash, randomUUID } from 'node:crypto';

import { withWorkspace, type Queryable, type Transaction } from '@causedeck/db';
import { blob } from '@causedeck/db/schema';
import { and, eq } from 'drizzle-orm';

import { storageAuditSink } from './audit.ts';
import { isUuid, objectKey, parseObjectKey, type ObjectKey } from './keys.ts';
import { assertWithinLimit, isObjectKind, ObjectTooLargeError, type ObjectKind } from './limits.ts';
import { findAllowedType, isCompatible, sniffMime } from './mime.ts';
import { ObjectNotFoundError, type ObjectStore, type SignedUpload } from './provider.ts';

export type StorageAction = 'document.read' | 'document.write';

export interface StorageCtx {
  db: Queryable;
  store: ObjectStore;
  /** The workspace the caller is a checked member of. */
  workspaceId: string;
  userId: string;
  /** The `assertCan` seam: throws (e.g. `ForbiddenError`) when the caller may not take `action`. */
  authorize(action: StorageAction): void | Promise<void>;
  now?: () => Date;
}

export type UploadErrorCode = 'NOT_FOUND' | 'VALIDATION' | 'FORBIDDEN' | 'TOO_LARGE';

/** A client-safe upload or download failure; `message` never names another workspace's data. */
export class UploadError extends Error {
  override name = 'UploadError';

  constructor(
    readonly code: UploadErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isUploadError(error: unknown): error is UploadError {
  return error instanceof UploadError;
}

export const blobNotFound = (): UploadError => new UploadError('NOT_FOUND', 'not found');

export interface UploadIntentInput {
  kind: string;
  filename: string;
  size: number;
  mime: string;
  /** Presigned URL lifetime, 1 to 600 seconds; defaults to 5 minutes (#43 asks for 10). */
  uploadTtlSeconds?: number;
}

export interface UploadIntent {
  blobId: string;
  key: ObjectKey;
  upload: SignedUpload;
}

export interface FinalizedUpload {
  blobId: string;
  kind: ObjectKind;
  filename: string;
  size: number;
  sha256: string;
  mime: string;
  scanStatus: 'pending' | 'clean' | 'infected' | 'skipped';
}

type BlobRow = typeof blob.$inferSelect;

const MAX_FILENAME_LENGTH = 255;

/** Path separators and control characters (C0 and DEL). */
// eslint-disable-next-line no-control-regex
const BAD_FILENAME_CHARS = /[/\\\u0000-\u001f\u007f]/;

/** A display name only (never a path): 1-255 characters, no separators or control characters. */
function checkFilename(filename: string): string {
  const name = filename.normalize('NFC');
  if (name.length === 0 || name.length > MAX_FILENAME_LENGTH || BAD_FILENAME_CHARS.test(name)) {
    throw new UploadError('VALIDATION', 'invalid file name');
  }
  if (name === '.' || name === '..') throw new UploadError('VALIDATION', 'invalid file name');
  return name;
}

function checkSize(kind: ObjectKind, size: number): void {
  try {
    assertWithinLimit(kind, size);
  } catch (error) {
    if (error instanceof ObjectTooLargeError) {
      throw new UploadError('TOO_LARGE', error.message);
    }
    throw new UploadError('VALIDATION', 'invalid size');
  }
  if (size === 0) throw new UploadError('VALIDATION', 'empty file');
}

/** Load a blob of the scoped workspace; anything else (absent, RLS-hidden, foreign key) is null. */
export async function loadBlob(
  tx: Transaction,
  workspaceId: string,
  blobId: string,
  lock = false,
): Promise<BlobRow | null> {
  if (!isUuid(blobId)) return null;
  const query = tx
    .select()
    .from(blob)
    .where(and(eq(blob.id, blobId), eq(blob.workspaceId, workspaceId)));
  const [row] = lock ? await query.for('update') : await query;
  if (row === undefined) return null;
  // Defence in depth: the key must sit under the scoped workspace's prefix.
  if (parseObjectKey(row.key).workspaceId !== workspaceId) return null;
  return row;
}

/** Validate an upload and return a presigned PUT for its server-built key. */
export async function createUploadIntent(
  ctx: StorageCtx,
  input: UploadIntentInput,
): Promise<UploadIntent> {
  await ctx.authorize('document.write');
  const { kind } = input;
  if (!isObjectKind(kind)) throw new UploadError('VALIDATION', 'unknown kind');
  const filename = checkFilename(input.filename);
  const allowed = findAllowedType(kind, filename, input.mime);
  if (allowed === null) throw new UploadError('VALIDATION', 'file type not allowed');
  checkSize(kind, input.size);

  const now = ctx.now?.() ?? new Date();
  const blobId = randomUUID();
  const key = objectKey({ workspaceId: ctx.workspaceId, kind, id: blobId }, now);
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    await tx.insert(blob).values({
      id: blobId,
      workspaceId: ctx.workspaceId,
      key,
      kind,
      filename,
      size: input.size,
      mime: allowed.mime,
      createdBy: ctx.userId,
      createdAt: now,
    });
    // Signed after the insert, in the same transaction: a signing failure leaves no intent behind.
    const upload = await ctx.store.presignPut({
      key,
      contentType: allowed.mime,
      contentLength: input.size,
      ...(input.uploadTtlSeconds === undefined ? {} : { expiresInSeconds: input.uploadTtlSeconds }),
    });
    return { blobId, key, upload };
  });
}

function finalized(row: BlobRow): FinalizedUpload {
  return {
    blobId: row.id,
    kind: row.kind as ObjectKind,
    filename: row.filename,
    size: row.size,
    sha256: row.sha256 ?? '',
    mime: row.mime,
    scanStatus: row.scanStatus ?? 'pending',
  };
}

type Outcome = { ok: true; result: FinalizedUpload } | { ok: false; error: UploadError };

/**
 * Verify the uploaded bytes and mark the blob ready for scanning. Idempotent once finalized. A
 * rejected upload is deleted (object and row) before the `VALIDATION` / `TOO_LARGE` error.
 */
export async function finalizeUpload(ctx: StorageCtx, blobId: string): Promise<FinalizedUpload> {
  await ctx.authorize('document.write');
  const scope = { workspaceId: ctx.workspaceId, userId: ctx.userId };
  // The rejection path commits its deletes, so it returns the error and throws after the commit.
  const outcome = await withWorkspace(ctx.db, scope, async (tx): Promise<Outcome> => {
    const row = await loadBlob(tx, ctx.workspaceId, blobId, true);
    if (row === null) throw blobNotFound();
    if (row.finalizedAt !== null) return { ok: true, result: finalized(row) };
    const key = row.key as ObjectKey;

    let body: Uint8Array;
    try {
      ({ body } = await ctx.store.get(key));
    } catch (error) {
      // Not uploaded yet: keep the intent so the client can still PUT before its URL expires.
      if (error instanceof ObjectNotFoundError) {
        throw new UploadError('VALIDATION', 'upload not received');
      }
      throw error;
    }

    const reject = async (error: UploadError): Promise<Outcome> => {
      await ctx.store.delete(key);
      await tx.delete(blob).where(eq(blob.id, row.id));
      return { ok: false, error };
    };

    const kind = row.kind as ObjectKind;
    if (body.byteLength !== row.size) {
      return reject(new UploadError('VALIDATION', 'size does not match the declared size'));
    }
    try {
      checkSize(kind, body.byteLength);
    } catch (error) {
      return reject(error as UploadError);
    }
    const allowed = findAllowedType(kind, row.filename, row.mime);
    const sniffed = await sniffMime(body);
    if (allowed === null || !isCompatible(allowed, sniffed)) {
      return reject(new UploadError('VALIDATION', 'file content does not match an allowed type'));
    }

    const now = ctx.now?.() ?? new Date();
    const sha256 = createHash('sha256').update(body).digest('hex');
    const [updated] = await tx
      .update(blob)
      .set({ mime: sniffed, sha256, scanStatus: 'pending', finalizedAt: now })
      .where(eq(blob.id, row.id))
      .returning();
    if (updated === undefined) throw blobNotFound();
    await storageAuditSink.write(tx, {
      action: 'document.upload_finalized',
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      blobId: row.id,
      at: now,
    });
    return { ok: true, result: finalized(updated) };
  });
  if (!outcome.ok) throw outcome.error;
  return outcome.result;
}
