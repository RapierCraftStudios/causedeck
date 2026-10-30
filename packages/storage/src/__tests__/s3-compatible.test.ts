// Provider swap by env only (#106): the shared ObjectStore contract runs against an S3-compatible
// target built through `createObjectStoreFromEnv`, next to the MinIO run in minio.test.ts. The two
// targets differ only in the env values handed to the factory (endpoint, bucket, keys, provider).
import { Secret } from '@causedeck/config/env';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { objectKey } from '../keys.ts';
import { createObjectStoreFromEnv, type StorageEnv } from '../s3-provider.ts';

import { objectStoreContract } from './object-store.contract.ts';
import { MOCK_ACCESS_KEY, MOCK_SECRET_KEY, startS3Mock, type StartedS3Mock } from './s3-mock.ts';

const BUCKET = 'causedeck-stage-b';
let mock: StartedS3Mock;

beforeAll(async () => {
  mock = await startS3Mock();
  mock.createBucket(BUCKET);
});

afterAll(async () => {
  await mock.stop();
});

afterEach(() => {
  vi.useRealTimers();
});

const env = (overrides: Partial<StorageEnv> = {}): StorageEnv => ({
  STORAGE_PROVIDER: 'minio',
  S3_ENDPOINT: mock.endpoint,
  S3_REGION: 'ap-south-1',
  S3_BUCKET: BUCKET,
  S3_ACCESS_KEY: new Secret(MOCK_ACCESS_KEY),
  S3_SECRET_KEY: new Secret(MOCK_SECRET_KEY),
  ...overrides,
});

objectStoreContract('S3-compatible mock via createObjectStoreFromEnv', () => {
  vi.useRealTimers();
  return {
    store: createObjectStoreFromEnv(env()),
    // Faking only `Date` skews the signing clock; the mock keeps its own monotonic clock.
    setNow: (now) => {
      if (vi.isFakeTimers()) vi.setSystemTime(now);
      else vi.useFakeTimers({ toFake: ['Date'], now });
    },
    upload: async (url, body, contentType) => {
      const response = await fetch(url, {
        method: 'PUT',
        body,
        headers: { 'content-type': contentType },
      });
      await response.arrayBuffer();
      return response.status;
    },
    download: async (url) => {
      const response = await fetch(url);
      const body = new Uint8Array(await response.arrayBuffer());
      return response.ok ? { status: response.status, body } : { status: response.status };
    },
  };
});

describe('provider swap by env only', () => {
  it('reads the same objects through a second store built from different env values', async () => {
    const a = createObjectStoreFromEnv(env());
    const b = createObjectStoreFromEnv(env({ STORAGE_PROVIDER: 's3' }));
    const key = objectKey({
      workspaceId: crypto.randomUUID(),
      kind: 'document',
      id: crypto.randomUUID(),
    });
    await a.put({ key, body: new Uint8Array([1, 2, 3]), contentType: 'text/plain' });
    expect((await b.get(key)).body).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects an out-of-India region by env alone', () => {
    expect(() => createObjectStoreFromEnv(env({ S3_REGION: 'us-east-1' }))).toThrow();
  });
});
