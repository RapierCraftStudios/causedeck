// The `ObjectStore` contract and signed-URL binding against a real MinIO (Testcontainers), plus
// credential hygiene of SDK errors.
import { inspect } from 'node:util';

import { Secret } from '@causedeck/config/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { storageReadyCheck } from '../health.ts';
import { objectKey } from '../keys.ts';
import { createS3ObjectStore } from '../s3-provider.ts';

import { startMinio, MINIO_PASSWORD, MINIO_USER, type StartedMinio } from './minio.ts';
import { objectStoreContract } from './object-store.contract.ts';

const BUCKET = 'causedeck-test';
let minio: StartedMinio;
let clock: Date | undefined;

beforeAll(async () => {
  minio = await startMinio();
  await minio.createBucket(BUCKET);
}, 180_000);

afterAll(async () => {
  await minio.stop();
});

function store(overrides: { bucket?: string; accessKey?: string; secretKey?: string } = {}) {
  return createS3ObjectStore({
    endpoint: minio.endpoint,
    region: 'ap-south-1',
    bucket: overrides.bucket ?? BUCKET,
    accessKey: new Secret(overrides.accessKey ?? MINIO_USER),
    secretKey: new Secret(overrides.secretKey ?? MINIO_PASSWORD),
    now: () => clock ?? new Date(),
  });
}

objectStoreContract('s3-provider on MinIO', () => {
  clock = undefined;
  return {
    store: store(),
    setNow: (now) => {
      clock = now;
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

describe('s3-provider signed PUT URL', () => {
  it('expires in 300 seconds and signs host, content-type and content-length', async () => {
    const key = objectKey({
      workspaceId: crypto.randomUUID(),
      kind: 'document',
      id: crypto.randomUUID(),
    });
    const signed = await store().presignPut({
      key,
      contentType: 'application/pdf',
      contentLength: 10,
    });
    const url = new URL(signed.url);

    expect(url.pathname).toBe(`/${BUCKET}/${key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'host']),
    );
  });
});

describe('s3-provider credentials', () => {
  it('never puts the access or secret key in errors', async () => {
    const accessKey = 'AKIALEAKCHECK0001';
    const secretKey = 'leak-check-secret-value-0001';
    const bad = store({ accessKey, secretKey });
    const key = objectKey({
      workspaceId: crypto.randomUUID(),
      kind: 'document',
      id: crypto.randomUUID(),
    });

    const error = await bad.put({ key, body: new Uint8Array([1]), contentType: 'text/plain' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const rendered = [
      String(error),
      JSON.stringify(error),
      inspect(error, { depth: 10, showHidden: true }),
      inspect(bad, { depth: 10, showHidden: true }),
      JSON.stringify(bad),
    ].join('\n');
    expect(rendered).not.toContain(accessKey);
    expect(rendered).not.toContain(secretKey);
    expect(rendered).toMatch(/storage put failed: \w+ \(403\)/);
  });
});

describe('s3-provider readiness', () => {
  it('storage check passes for the bucket and fails for a missing one', async () => {
    await expect(storageReadyCheck(store())()).resolves.toBeUndefined();
    await expect(storageReadyCheck(store({ bucket: 'no-such-bucket' }))()).rejects.toThrow();
  });
});
