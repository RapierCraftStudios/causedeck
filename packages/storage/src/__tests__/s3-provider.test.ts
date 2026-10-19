// s3-provider configuration without a server: region residency, R2 refusal, env selection,
// unreachable endpoints and credential hygiene.
import { inspect } from 'node:util';

import { Secret } from '@causedeck/config/env';
import { describe, expect, it } from 'vitest';

import { storageReadyCheck } from '../health.ts';
import { objectKey } from '../keys.ts';
import {
  createObjectStoreFromEnv,
  createS3ObjectStore,
  StorageConfigError,
  type StorageEnv,
} from '../s3-provider.ts';

const ACCESS = 'AKIAUNITACCESSKEY01';
const SECRET = 'unit-secret-key-value-01';

const base = {
  region: 'ap-south-1',
  bucket: 'causedeck-test',
  accessKey: new Secret(ACCESS),
  secretKey: new Secret(SECRET),
};

const env = (overrides: Partial<StorageEnv> = {}): StorageEnv => ({
  STORAGE_PROVIDER: 's3',
  S3_REGION: 'ap-south-1',
  S3_BUCKET: 'causedeck-prod',
  S3_ACCESS_KEY: new Secret(ACCESS),
  S3_SECRET_KEY: new Secret(SECRET),
  ...overrides,
});

const key = () =>
  objectKey({ workspaceId: crypto.randomUUID(), kind: 'document', id: crypto.randomUUID() });

describe('s3-provider region residency', () => {
  it.each(['ap-south-1', 'ap-south-2'])('accepts %s', (region) => {
    expect(() => createS3ObjectStore({ ...base, region })).not.toThrow();
  });

  it.each(['us-east-1', 'eu-west-1', 'ap-southeast-1'])(
    'rejects %s without the override',
    (region) => {
      expect(() => createS3ObjectStore({ ...base, region })).toThrow(StorageConfigError);
      expect(() =>
        createS3ObjectStore({ ...base, region, allowNonIndiaRegion: true }),
      ).not.toThrow();
    },
  );

  it('rejects a non-India region from env unless AWS_REGION_OVERRIDE_ACK=I_UNDERSTAND', () => {
    expect(() => createObjectStoreFromEnv(env({ S3_REGION: 'us-east-1' }))).toThrow(
      StorageConfigError,
    );
    expect(() =>
      createObjectStoreFromEnv(
        env({ S3_REGION: 'us-east-1', AWS_REGION_OVERRIDE_ACK: 'I_UNDERSTAND' }),
      ),
    ).not.toThrow();
  });

  it('refuses Cloudflare R2 endpoints for tenant documents', () => {
    expect(() =>
      createS3ObjectStore({ ...base, endpoint: 'https://acct.r2.cloudflarestorage.com' }),
    ).toThrow(/R2/);
  });
});

describe('createObjectStoreFromEnv', () => {
  it('STORAGE_PROVIDER=s3 signs virtual-hosted AWS S3 ap-south-1 URLs with no code change', async () => {
    const signed = await createObjectStoreFromEnv(env()).presignGet(key());
    const url = new URL(signed.url);

    expect(url.hostname).toBe('causedeck-prod.s3.ap-south-1.amazonaws.com');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/ap-south-1/s3/aws4_request');
  });

  it('STORAGE_PROVIDER=minio signs path-style URLs on the configured endpoint', async () => {
    const k = key();
    const signed = await createObjectStoreFromEnv(
      env({ STORAGE_PROVIDER: 'minio', S3_ENDPOINT: 'http://localhost:9000' }),
    ).presignGet(k);

    expect(signed.url.startsWith(`http://localhost:9000/causedeck-prod/${k}?`)).toBe(true);
  });
});

describe('s3-provider unreachable bucket', () => {
  const unreachable = () => createS3ObjectStore({ ...base, endpoint: 'http://127.0.0.1:1' });

  it('storage readiness check rejects', async () => {
    await expect(storageReadyCheck(unreachable())()).rejects.toThrow(/storage ping failed/);
  });

  it('errors and the store itself never render the credentials', async () => {
    const store = unreachable();
    const error = await store.get(key()).then(
      () => undefined,
      (e: unknown) => e,
    );
    const rendered = [
      String(error),
      JSON.stringify(error),
      inspect(error, { depth: 10, showHidden: true }),
      inspect(store, { depth: 10, showHidden: true }),
      JSON.stringify(store),
    ].join('\n');

    expect(error).toBeInstanceOf(Error);
    expect(rendered).not.toContain(ACCESS);
    expect(rendered).not.toContain(SECRET);
  });
});
