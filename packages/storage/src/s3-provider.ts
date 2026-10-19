// `ObjectStore` over the S3 API: MinIO on the VPS (path-style, custom endpoint) or AWS S3 in
// ap-south-1. India-only unless explicitly overridden; Cloudflare R2 is refused for tenant data.
// Credentials stay in `Secret`s and SDK errors are rewrapped so neither key reaches a log.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { INDIA_AWS_REGIONS, OVERRIDE_ACK, type Secret } from '@causedeck/config/env';

import { isObjectKey, type ObjectKey } from './keys.ts';
import {
  checkDownloadOptions,
  checkedKey,
  checkUpload,
  expiry,
  listPrefix,
  ObjectNotFoundError,
  requireContentType,
  SIGNED_URL_TTL_SECONDS,
  StorageError,
  type ObjectMeta,
  type ObjectStore,
} from './provider.ts';

export interface S3ObjectStoreOptions {
  /** Custom S3-compatible endpoint (MinIO). Omit for AWS S3. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: Secret;
  secretKey: Secret;
  /** Defaults to `true` when `endpoint` is set (MinIO needs path-style URLs). */
  forcePathStyle?: boolean;
  /** Allow a region outside India; only with `AWS_REGION_OVERRIDE_ACK`. */
  allowNonIndiaRegion?: boolean;
  /** Clock used to sign URLs; defaults to the system clock. */
  now?: () => Date;
}

/** The env keys `createObjectStoreFromEnv` reads (a subset of `ServerEnv`). */
export interface StorageEnv {
  STORAGE_PROVIDER: 'minio' | 's3';
  S3_ENDPOINT?: string | undefined;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY: Secret;
  S3_SECRET_KEY: Secret;
  AWS_REGION_OVERRIDE_ACK?: string | undefined;
}

export class StorageConfigError extends Error {
  override name = 'StorageConfigError';
}

const SIGNED_HEADERS = new Set(['content-type', 'content-length']);

function isIndiaRegion(region: string): boolean {
  return (INDIA_AWS_REGIONS as readonly string[]).includes(region);
}

function isR2(endpoint: string): boolean {
  const host = new URL(endpoint).hostname.toLowerCase();
  return host === 'r2.cloudflarestorage.com' || host.endsWith('.r2.cloudflarestorage.com');
}

/** Rewrap an SDK error with its name and status only: S3 error bodies echo the access key id. */
function wrap(operation: string, error: unknown): StorageError {
  const e = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  const code = typeof e?.name === 'string' && /^\w{1,64}$/.test(e.name) ? e.name : 'UnknownError';
  const status = e?.$metadata?.httpStatusCode;
  return new StorageError(operation, code, typeof status === 'number' ? status : undefined);
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

export function createS3ObjectStore(options: S3ObjectStoreOptions): ObjectStore {
  const { endpoint, region, bucket, accessKey, secretKey } = options;
  if (!isIndiaRegion(region) && options.allowNonIndiaRegion !== true) {
    throw new StorageConfigError(
      `storage region ${region} is outside India (${INDIA_AWS_REGIONS.join(', ')}); set AWS_REGION_OVERRIDE_ACK to allow it`,
    );
  }
  if (endpoint !== undefined && isR2(endpoint)) {
    throw new StorageConfigError('Cloudflare R2 must not hold tenant documents');
  }
  if (bucket.length === 0) throw new StorageConfigError('storage bucket is required');
  const now = options.now ?? (() => new Date());

  const client = new S3Client({
    region,
    ...(endpoint === undefined ? {} : { endpoint }),
    forcePathStyle: options.forcePathStyle ?? endpoint !== undefined,
    credentials: () =>
      Promise.resolve({ accessKeyId: accessKey.reveal(), secretAccessKey: secretKey.reveal() }),
    maxAttempts: 2,
  });

  const call = async <T>(operation: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      throw wrap(operation, error);
    }
  };

  return {
    async put(input) {
      checkUpload(input.key, input.body.byteLength);
      requireContentType(input.contentType);
      await call('put', () =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: input.key,
            Body: input.body,
            ContentType: input.contentType,
            ContentLength: input.body.byteLength,
          }),
        ),
      );
    },

    async get(key) {
      checkedKey(key);
      let output;
      try {
        output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (isNotFound(error)) throw new ObjectNotFoundError(key);
        throw wrap('get', error);
      }
      const body = await call('get', async () => {
        if (!output.Body) return new Uint8Array();
        return output.Body.transformToByteArray();
      });
      return {
        body,
        meta: {
          key,
          size: body.byteLength,
          ...(output.ContentType === undefined ? {} : { contentType: output.ContentType }),
          ...(output.LastModified === undefined ? {} : { lastModified: output.LastModified }),
        },
      };
    },

    async head(key) {
      checkedKey(key);
      try {
        const output = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          key,
          size: output.ContentLength ?? 0,
          ...(output.ContentType === undefined ? {} : { contentType: output.ContentType }),
          ...(output.LastModified === undefined ? {} : { lastModified: output.LastModified }),
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw wrap('head', error);
      }
    },

    async delete(key) {
      checkedKey(key);
      await call('delete', () =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      );
    },

    async list(workspaceId, listOptions) {
      const prefix = listPrefix(workspaceId, listOptions);
      const out: ObjectMeta[] = [];
      let token: string | undefined;
      do {
        const page = await call('list', () =>
          client.send(
            new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
          ),
        );
        for (const item of page.Contents ?? []) {
          // Anything not shaped like one of our keys is ignored rather than handed to callers.
          if (item.Key === undefined || !isObjectKey(item.Key)) continue;
          out.push({
            key: item.Key,
            size: item.Size ?? 0,
            ...(item.LastModified === undefined ? {} : { lastModified: item.LastModified }),
          });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
      return out;
    },

    async presignPut(input) {
      checkUpload(input.key, input.contentLength);
      requireContentType(input.contentType);
      const signingDate = now();
      const url = await call('presignPut', () =>
        getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: bucket,
            Key: input.key,
            ContentType: input.contentType,
            ContentLength: input.contentLength,
          }),
          { expiresIn: SIGNED_URL_TTL_SECONDS, signingDate, signableHeaders: SIGNED_HEADERS },
        ),
      );
      return {
        url,
        method: 'PUT',
        headers: {
          'content-type': input.contentType,
          'content-length': String(input.contentLength),
        },
        expiresAt: expiry(signingDate),
      };
    },

    async presignGet(key: ObjectKey, options = {}) {
      checkedKey(key);
      const ttl = checkDownloadOptions(options);
      const signingDate = now();
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(options.contentDisposition === undefined
          ? {}
          : { ResponseContentDisposition: options.contentDisposition }),
        ...(options.contentType === undefined ? {} : { ResponseContentType: options.contentType }),
      });
      const url = await call('presignGet', () =>
        getSignedUrl(client, command, { expiresIn: ttl, signingDate }),
      );
      return { url, expiresAt: expiry(signingDate, ttl) };
    },

    async ping() {
      await call('ping', () => client.send(new HeadBucketCommand({ Bucket: bucket })));
    },
  };
}

/** Select the provider from env alone: `STORAGE_PROVIDER=s3` is AWS S3, `minio` is MinIO. */
export function createObjectStoreFromEnv(env: StorageEnv): ObjectStore {
  return createS3ObjectStore({
    ...(env.S3_ENDPOINT === undefined ? {} : { endpoint: env.S3_ENDPOINT }),
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    allowNonIndiaRegion: env.AWS_REGION_OVERRIDE_ACK === OVERRIDE_ACK,
  });
}
