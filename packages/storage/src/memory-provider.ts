// In-memory `ObjectStore` for unit tests and local runs without MinIO. Signed URLs are opaque
// `memory://` tokens with the same expiry and key/type/length binding as S3, enforced by
// `upload()` and `download()`.
import { randomUUID } from 'node:crypto';

import type { ObjectKey } from './keys.ts';
import {
  checkDownloadOptions,
  checkedKey,
  checkUpload,
  expiry,
  listPrefix,
  ObjectNotFoundError,
  requireContentType,
  StorageError,
  type ObjectMeta,
  type ObjectStore,
  type SignedUpload,
} from './provider.ts';

export interface MemoryObjectStoreOptions {
  /** Clock used to sign and check URLs; defaults to the system clock. */
  now?: () => Date;
  /** Make `ping()` fail, to simulate an unreachable bucket. */
  unreachable?: boolean;
}

interface Grant {
  method: 'PUT' | 'GET';
  key: ObjectKey;
  expiresAt: Date;
  contentType?: string;
  contentLength?: number;
  contentDisposition?: string;
}

interface Entry {
  body: Uint8Array;
  contentType: string;
  lastModified: Date;
}

export interface MemoryObjectStore extends ObjectStore {
  /** Perform a signed PUT the way a browser would; rejects like S3 does (403) on any mismatch. */
  upload(url: string, init: { body: Uint8Array; contentType: string }): Promise<void>;
  /** Perform a signed GET. */
  download(url: string): Promise<Uint8Array>;
  /** Perform a signed GET and return the response headers too, as the storage edge serves them. */
  fetchSigned(url: string): Promise<{ body: Uint8Array; headers: Record<string, string> }>;
}

/** Run `fn` and surface any throw as a rejected promise, like a real network provider. */
function settle<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

const forbidden = (operation: string) => new StorageError(operation, 'AccessDenied', 403);

export function createMemoryObjectStore(options: MemoryObjectStoreOptions = {}): MemoryObjectStore {
  const now = options.now ?? (() => new Date());
  const objects = new Map<string, Entry>();
  const grants = new Map<string, Grant>();

  const meta = (key: ObjectKey, entry: Entry): ObjectMeta => ({
    key,
    size: entry.body.byteLength,
    contentType: entry.contentType,
    lastModified: entry.lastModified,
  });

  const sign = (grant: Grant): string => {
    const token = randomUUID();
    grants.set(token, grant);
    return `memory://objects/${grant.key}?token=${token}`;
  };

  const redeem = (url: string, method: Grant['method']): Grant => {
    const token = new URL(url).searchParams.get('token') ?? '';
    const grant = grants.get(token);
    if (!grant || grant.method !== method || now() > grant.expiresAt) throw forbidden(method);
    return grant;
  };

  const put = (key: ObjectKey, body: Uint8Array, contentType: string) => {
    objects.set(key, { body: body.slice(), contentType, lastModified: now() });
  };

  return {
    put: (input) =>
      settle(() => {
        checkUpload(input.key, input.body.byteLength);
        requireContentType(input.contentType);
        put(input.key, input.body, input.contentType);
      }),
    get: (key) =>
      settle(() => {
        checkedKey(key);
        const entry = objects.get(key);
        if (!entry) throw new ObjectNotFoundError(key);
        return { body: entry.body.slice(), meta: meta(key, entry) };
      }),
    head: (key) =>
      settle(() => {
        checkedKey(key);
        const entry = objects.get(key);
        return entry ? meta(key, entry) : null;
      }),
    delete: (key) =>
      settle(() => {
        checkedKey(key);
        objects.delete(key);
      }),
    list: (workspaceId, listOptions) =>
      settle(() => {
        const prefix = listPrefix(workspaceId, listOptions);
        return [...objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, entry]) => meta(key as ObjectKey, entry));
      }),
    presignPut: (input) =>
      settle((): SignedUpload => {
        checkUpload(input.key, input.contentLength);
        requireContentType(input.contentType);
        const expiresAt = expiry(now());
        const url = sign({
          method: 'PUT',
          key: input.key,
          expiresAt,
          contentType: input.contentType,
          contentLength: input.contentLength,
        });
        return {
          url,
          method: 'PUT',
          headers: {
            'content-type': input.contentType,
            'content-length': String(input.contentLength),
          },
          expiresAt,
        };
      }),
    presignGet: (key, getOptions = {}) =>
      settle(() => {
        checkedKey(key);
        const expiresAt = expiry(now(), checkDownloadOptions(getOptions));
        const grant: Grant = { method: 'GET', key, expiresAt };
        if (getOptions.contentType !== undefined) grant.contentType = getOptions.contentType;
        if (getOptions.contentDisposition !== undefined) {
          grant.contentDisposition = getOptions.contentDisposition;
        }
        return { url: sign(grant), expiresAt };
      }),
    ping: () =>
      settle(() => {
        if (options.unreachable) throw new StorageError('ping', 'Unreachable');
      }),
    upload: (url, init) =>
      settle(() => {
        const grant = redeem(url, 'PUT');
        if (
          grant.contentType !== init.contentType ||
          grant.contentLength !== init.body.byteLength
        ) {
          throw forbidden('PUT');
        }
        put(grant.key, init.body, init.contentType);
      }),
    download: (url) =>
      settle(() => {
        const grant = redeem(url, 'GET');
        const entry = objects.get(grant.key);
        if (!entry) throw new ObjectNotFoundError(grant.key);
        return entry.body.slice();
      }),
    fetchSigned: (url) =>
      settle(() => {
        const grant = redeem(url, 'GET');
        const entry = objects.get(grant.key);
        if (!entry) throw new ObjectNotFoundError(grant.key);
        const headers: Record<string, string> = {
          'content-type': grant.contentType ?? entry.contentType,
          'content-length': String(entry.body.byteLength),
          'x-content-type-options': 'nosniff',
        };
        if (grant.contentDisposition !== undefined) {
          headers['content-disposition'] = grant.contentDisposition;
        }
        return { body: entry.body.slice(), headers };
      }),
  };
}
