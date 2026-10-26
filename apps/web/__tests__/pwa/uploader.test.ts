/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-base-to-string -- test fixtures index known entries */
import { describe, expect, it, vi } from 'vitest';

import { enqueueFiles, MAX_ATTEMPTS } from '../../lib/pwa/outbox/queue.ts';
import { backoffMs, uploadItem } from '../../lib/pwa/outbox/uploader.ts';

import { deviceKey, file, memoryStore, WORKSPACE_ID } from './helpers.ts';

const CAPTURE_ID = '00000000-0000-4000-8000-0000000000c1';

function respond(status: number, body: object = {}) {
  return Response.json(body, { status });
}

/** A fake capture API: presign -> PUT -> complete, each answerable per test. */
function api(overrides: Partial<Record<'presign' | 'put' | 'complete', () => Response>> = {}) {
  const calls: string[] = [];
  const send = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const step = url.endsWith('/presign')
      ? 'presign'
      : url.endsWith('/complete')
        ? 'complete'
        : 'put';
    calls.push(`${init?.method ?? 'GET'} ${step}`);
    const custom = overrides[step];
    if (custom) return Promise.resolve(custom());
    if (step === 'presign') {
      return Promise.resolve(
        respond(201, {
          captureId: CAPTURE_ID,
          uploadUrl: 'https://store.example.test/put',
          headers: { 'content-type': 'application/pdf', 'content-length': '3' },
          expiresAt: '2026-10-22T00:00:00.000Z',
        }),
      );
    }
    if (step === 'complete') return Promise.resolve(respond(200, { status: 'scanning' }));
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  return { send: send as unknown as typeof fetch, calls, spy: send };
}

async function queued() {
  const store = memoryStore();
  const key = await deviceKey();
  const { items } = await enqueueFiles(store, key, [file('a.pdf', 'abc')], {
    workspaceId: WORKSPACE_ID,
    channel: 'share',
    matterHintId: '00000000-0000-4000-8000-0000000000aa',
  });
  return { store, key, item: items[0]! };
}

describe('uploader (#50)', () => {
  it('presigns, PUTs and completes, then deletes the blob', async () => {
    const { store, key, item } = await queued();
    const fake = api();
    expect(await uploadItem(item, { store, key, fetch: fake.send })).toBe('sent');
    expect(fake.calls).toEqual(['POST presign', 'PUT put', 'POST complete']);
    const body = JSON.parse(String(fake.spy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      workspaceId: WORKSPACE_ID,
      channel: 'share',
      filename: 'a.pdf',
      mime: 'application/pdf',
      sizeBytes: 3,
      sha256: item.sha256,
      matterHintId: '00000000-0000-4000-8000-0000000000aa',
    });
    const row = await store.get(item.id);
    expect(row?.state).toBe('sent');
    expect(row?.encryptedBlob.byteLength).toBe(0);
  });

  it('sends the sha256 on complete, where the server de-duplicates', async () => {
    const { store, key, item } = await queued();
    const fake = api({
      complete: () => respond(200, { status: 'duplicate', duplicateOf: CAPTURE_ID }),
    });
    expect(await uploadItem(item, { store, key, fetch: fake.send })).toBe('sent');
    const complete = fake.spy.mock.calls.at(-1);
    expect(String(complete?.[0])).toBe(`/api/captures/${CAPTURE_ID}/complete`);
    expect(JSON.parse(String(complete?.[1]?.body))).toEqual({
      workspaceId: WORKSPACE_ID,
      sha256: item.sha256,
    });
  });

  it('resumes after the PUT without presigning or uploading again', async () => {
    const { store, key, item } = await queued();
    const flaky = api({ complete: () => respond(503) });
    expect(
      await uploadItem(item, { store, key, fetch: flaky.send, random: () => 0.5, now: () => 0 }),
    ).toBe('retry');
    const afterFailure = await store.get(item.id);
    expect(afterFailure).toMatchObject({ state: 'queued', putDone: true, captureId: CAPTURE_ID });

    const healthy = api();
    expect(await uploadItem(afterFailure!, { store, key, fetch: healthy.send })).toBe('sent');
    expect(healthy.calls).toEqual(['POST complete']);
  });

  it('backs off with jitter: random up to a doubling ceiling, capped at 5 minutes', () => {
    expect(backoffMs(0, () => 1)).toBe(1_000);
    expect(backoffMs(3, () => 1)).toBe(8_000);
    expect(backoffMs(3, () => 0.5)).toBe(4_000);
    expect(backoffMs(3, () => 0)).toBe(0);
    expect(backoffMs(20, () => 1)).toBe(5 * 60 * 1000);
  });

  it('records the next attempt time from the backoff', async () => {
    const { store, key, item } = await queued();
    const down = api({ presign: () => respond(500) });
    await uploadItem(item, { store, key, fetch: down.send, random: () => 1, now: () => 10_000 });
    expect(await store.get(item.id)).toMatchObject({
      state: 'queued',
      attempts: 1,
      lastError: 'http_500',
      nextAttemptAt: 11_000,
    });
  });

  it('marks failed after 8 attempts', async () => {
    const { store, key, item } = await queued();
    const down = api({ presign: () => respond(500) });
    let outcome = 'retry';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = (await store.get(item.id))!;
      outcome = await uploadItem(current, { store, key, fetch: down.send, now: () => 0 });
    }
    expect(outcome).toBe('failed');
    expect(await store.get(item.id)).toMatchObject({ state: 'failed', attempts: MAX_ATTEMPTS });
  });

  it('treats a network error as retryable', async () => {
    const { store, key, item } = await queued();
    const offline = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(
      await uploadItem(item, {
        store,
        key,
        fetch: offline,
        now: () => 0,
      }),
    ).toBe('retry');
    expect((await store.get(item.id))?.lastError).toBe('network');
  });

  it.each([
    [413, 'too_large'],
    [415, 'unsupported_type'],
    [403, 'forbidden'],
  ])('fails at once on %s without retrying', async (status, reason) => {
    const { store, key, item } = await queued();
    const fake = api({ presign: () => respond(status) });
    expect(await uploadItem(item, { store, key, fetch: fake.send })).toBe('failed');
    expect(await store.get(item.id)).toMatchObject({
      state: 'failed',
      lastError: reason,
      attempts: 0,
    });
  });

  it('keeps the item queued, with no attempt spent, when signed out', async () => {
    const { store, key, item } = await queued();
    const fake = api({ presign: () => respond(401) });
    expect(await uploadItem(item, { store, key, fetch: fake.send })).toBe('signed-out');
    expect(await store.get(item.id)).toMatchObject({ state: 'queued', attempts: 0 });
  });

  it('skips an item with no workspace yet and never reads the network', async () => {
    const store = memoryStore();
    const key = await deviceKey();
    const { items } = await enqueueFiles(store, key, [file('a.pdf', 'abc')], {
      workspaceId: null,
      channel: 'share',
    });
    const fake = api();
    expect(await uploadItem(items[0]!, { store, key, fetch: fake.send })).toBe('skipped');
    expect(fake.spy).not.toHaveBeenCalled();
  });
});
