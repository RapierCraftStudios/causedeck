// The `ObjectStore` seam (#21): one interface over MinIO, AWS S3 and an in-memory fake, so
// callers never depend on a provider. Every method takes an `ObjectKey`, never a raw path.
import { parseObjectKey, workspacePrefix, type ObjectKey } from './keys.ts';
import { assertWithinLimit, isObjectKind, type ObjectKind } from './limits.ts';

/** Lifetime of every signed upload URL, and the default for downloads: 5 minutes. */
export const SIGNED_URL_TTL_SECONDS = 300;

/** Lifetime of a document download URL (`createDownloadUrl`, #217): 60 seconds. */
export const DOWNLOAD_URL_TTL_SECONDS = 60;

export interface ObjectMeta {
  key: ObjectKey;
  size: number;
  contentType?: string;
  lastModified?: Date;
}

export interface PutObjectInput {
  key: ObjectKey;
  body: Uint8Array;
  contentType: string;
}

export interface StoredObject {
  body: Uint8Array;
  meta: ObjectMeta;
}

export interface SignedUploadInput {
  key: ObjectKey;
  contentType: string;
  /** Exact size in bytes; the upload must match it. */
  contentLength: number;
}

export interface SignedUpload {
  url: string;
  method: 'PUT';
  /** Headers the client must send unchanged; they are part of the signature. */
  headers: { 'content-type': string; 'content-length': string };
  expiresAt: Date;
}

export interface SignedDownloadOptions {
  /** 1 to 300 seconds; defaults to `SIGNED_URL_TTL_SECONDS`. */
  expiresInSeconds?: number;
  /** Sent back as `Content-Disposition` (S3 `response-content-disposition`). */
  contentDisposition?: string;
  /** Sent back as `Content-Type` (S3 `response-content-type`), overriding the stored type. */
  contentType?: string;
}

export interface SignedDownload {
  url: string;
  expiresAt: Date;
}

export interface ListOptions {
  kind?: ObjectKind;
}

export interface ObjectStore {
  put(input: PutObjectInput): Promise<void>;
  /** Throws `ObjectNotFoundError` when the key does not exist. */
  get(key: ObjectKey): Promise<StoredObject>;
  /** `null` when the key does not exist. */
  head(key: ObjectKey): Promise<ObjectMeta | null>;
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: ObjectKey): Promise<void>;
  /** Objects under `ws/<workspaceId>/` (optionally one kind); the prefix is built here. */
  list(workspaceId: string, options?: ListOptions): Promise<ObjectMeta[]>;
  /** A PUT URL bound to the exact key, content type and length, valid for 5 minutes. */
  presignPut(input: SignedUploadInput): Promise<SignedUpload>;
  /** A GET URL for the key, valid for 5 minutes unless `options` shortens it. */
  presignGet(key: ObjectKey, options?: SignedDownloadOptions): Promise<SignedDownload>;
  /** Readiness probe: resolves when the bucket is reachable (head-bucket). */
  ping(): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  override name = 'ObjectNotFoundError';

  constructor(readonly key: ObjectKey) {
    super('object not found');
  }
}

/** A provider failure. The message names the operation only, never credentials or SDK detail. */
export class StorageError extends Error {
  override name = 'StorageError';

  constructor(
    readonly operation: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(
      `storage ${operation} failed: ${code}${status === undefined ? '' : ` (${String(status)})`}`,
    );
  }
}

/** Re-validate a key at the provider boundary (defends against unchecked casts). */
export function checkedKey(key: ObjectKey): ReturnType<typeof parseObjectKey> {
  return parseObjectKey(key);
}

/** Validate an upload against the key's kind limit; returns the parsed key. */
export function checkUpload(key: ObjectKey, bytes: number): ReturnType<typeof parseObjectKey> {
  const parsed = checkedKey(key);
  assertWithinLimit(parsed.kind, bytes);
  return parsed;
}

export function listPrefix(workspaceId: string, options: ListOptions = {}): string {
  const prefix = workspacePrefix(workspaceId);
  if (options.kind !== undefined && !isObjectKind(options.kind)) {
    throw new RangeError('unknown object kind');
  }
  return options.kind === undefined ? prefix : `${prefix}${options.kind}/`;
}

export function expiry(now: Date, seconds: number = SIGNED_URL_TTL_SECONDS): Date {
  return new Date(now.getTime() + seconds * 1000);
}

/** Validate download options; returns the TTL in seconds. */
export function checkDownloadOptions(options: SignedDownloadOptions = {}): number {
  const ttl = options.expiresInSeconds ?? SIGNED_URL_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > SIGNED_URL_TTL_SECONDS) {
    throw new RangeError('download URL lifetime must be 1 to 300 seconds');
  }
  if (options.contentType !== undefined) requireContentType(options.contentType);
  if (
    options.contentDisposition !== undefined &&
    !/^[\x20-\x7e]{1,4096}$/.test(options.contentDisposition)
  ) {
    throw new RangeError('invalid content disposition');
  }
  return ttl;
}

export function requireContentType(contentType: string): void {
  if (!/^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w.+-]+=[\w.+-]+)*$/.test(contentType)) {
    throw new RangeError('invalid content type');
  }
}
