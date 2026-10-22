import { describe, expect, it } from 'vitest';

import { decryptBytes } from '../../lib/pwa/outbox/crypto.ts';
import {
  assignWorkspace,
  canTransition,
  capStatus,
  DEFAULT_CAP_BYTES,
  enqueueFiles,
  listItems,
  markAttemptFailed,
  markSent,
  markUploading,
  MAX_ATTEMPTS,
  OutboxCapError,
  removeItem,
  retryItem,
  summarize,
  usedBytes,
} from '../../lib/pwa/outbox/queue.ts';

import { deviceKey, file, memoryStore, WORKSPACE_ID } from './helpers.ts';

const MB = 1024 * 1024;

describe('outbox cap (#50)', () => {
  it('defaults to 200 MB', () => {
    expect(DEFAULT_CAP_BYTES).toBe(200 * MB);
  });

  it('is ok below 80%, warns from 80%, blocks past 100%', () => {
    const cap = 100;
    expect(capStatus(0, 79, cap).level).toBe('ok');
    expect(capStatus(0, 80, cap).level).toBe('warn');
    expect(capStatus(50, 50, cap).level).toBe('warn');
    expect(capStatus(50, 51, cap).level).toBe('blocked');
    expect(capStatus(100, 1, cap).level).toBe('blocked');
  });

  it('counts only what is still on the device', async () => {
    const store = memoryStore();
    const key = await deviceKey();
    const { items } = await enqueueFiles(store, key, [file('a.pdf', 'aaaa'), file('b.pdf', 'bb')], {
      workspaceId: WORKSPACE_ID,
      channel: 'share',
    });
    expect(usedBytes(await store.all())).toBe(6);
    await markUploading(store, items[0]!.id);
    await markSent(store, items[0]!.id);
    expect(usedBytes(await store.all())).toBe(2);
  });

  it('blocks a new item at the cap and stores nothing', async () => {
    const store = memoryStore();
    const key = await deviceKey();
    await enqueueFiles(store, key, [file('a.pdf', '12345678')], {
      workspaceId: WORKSPACE_ID,
      channel: 'share',
      capBytes: 10,
    });
    await expect(
      enqueueFiles(store, key, [file('b.pdf', '123'), file('c.pdf', '45')], {
        workspaceId: WORKSPACE_ID,
        channel: 'share',
        capBytes: 10,
      }),
    ).rejects.toBeInstanceOf(OutboxCapError);
    expect(store.rows.size).toBe(1);
  });
});

describe('enqueueFiles (#50)', () => {
  it('writes encrypted rows with the specified shape, in one batch', async () => {
    const store = memoryStore();
    const key = await deviceKey();
    const result = await enqueueFiles(store, key, [file('order.pdf', 'order text')], {
      workspaceId: null,
      channel: 'share',
      now: 1_000,
    });
    const [row] = await store.all();
    expect(row).toMatchObject({
      batchId: result.batchId,
      workspaceId: null,
      channel: 'share',
      name: 'order.pdf',
      mime: 'application/pdf',
      size: 10,
      state: 'queued',
      attempts: 0,
      lastError: null,
      createdAt: 1_000,
    });
    expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.iv).toHaveLength(12);
    expect(new TextDecoder().decode(row?.encryptedBlob)).not.toContain('order text');
    expect(new TextDecoder().decode(await decryptBytes(key, row!))).toBe('order text');
  });

  it('gives the same bytes the same sha256 (the idempotency key)', async () => {
    const store = memoryStore();
    const key = await deviceKey();
    await enqueueFiles(store, key, [file('a.pdf', 'same'), file('copy.pdf', 'same')], {
      workspaceId: WORKSPACE_ID,
      channel: 'share',
    });
    const [a, b] = await store.all();
    expect(a?.sha256).toBe(b?.sha256);
  });

  it('names an unnamed file and types an untyped one', async () => {
    const store = memoryStore();
    await enqueueFiles(store, await deviceKey(), [new File(['x'], '')], {
      workspaceId: null,
      channel: 'share',
    });
    expect(await store.all()).toMatchObject([
      { name: 'shared-file', mime: 'application/octet-stream' },
    ]);
  });
});

describe('outbox state machine (#50)', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('queued', 'uploading')).toBe(true);
    expect(canTransition('uploading', 'sent')).toBe(true);
    expect(canTransition('uploading', 'failed')).toBe(true);
    expect(canTransition('failed', 'queued')).toBe(true);
    expect(canTransition('queued', 'sent')).toBe(false);
    expect(canTransition('sent', 'queued')).toBe(false);
  });

  async function oneQueued() {
    const store = memoryStore();
    const { items } = await enqueueFiles(store, await deviceKey(), [file('a.pdf', 'abc')], {
      workspaceId: WORKSPACE_ID,
      channel: 'share',
    });
    return { store, id: items[0]!.id };
  }

  it('deletes the blob as soon as the item is sent', async () => {
    const { store, id } = await oneQueued();
    await markUploading(store, id);
    const sent = await markSent(store, id);
    expect(sent?.state).toBe('sent');
    expect(sent?.encryptedBlob.byteLength).toBe(0);
  });

  it('fails after 8 attempts and Retry puts it back', async () => {
    const { store, id } = await oneQueued();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await markUploading(store, id);
      const row = await markAttemptFailed(store, id, 'network', 0);
      expect(row?.state).toBe(attempt === MAX_ATTEMPTS ? 'failed' : 'queued');
    }
    expect((await store.get(id))?.attempts).toBe(MAX_ATTEMPTS);
    const retried = await retryItem(store, id);
    expect(retried).toMatchObject({ state: 'queued', attempts: 0, lastError: null });
  });

  it('removing an item deletes the row and its blob', async () => {
    const { store, id } = await oneQueued();
    await removeItem(store, id);
    expect(store.rows.size).toBe(0);
  });

  it('ignores a transition the state does not allow', async () => {
    const { store, id } = await oneQueued();
    expect(await markSent(store, id)).toBeUndefined();
    expect((await store.get(id))?.state).toBe('queued');
  });
});

describe('batches and summaries (#50)', () => {
  it('assigns a workspace and matter hint to a whole batch', async () => {
    const store = memoryStore();
    const { batchId } = await enqueueFiles(
      store,
      await deviceKey(),
      [file('a.pdf', '1'), file('b.pdf', '2')],
      { workspaceId: null, channel: 'share' },
    );
    await assignWorkspace(store, batchId, WORKSPACE_ID, '00000000-0000-4000-8000-0000000000aa');
    expect((await store.all()).map((row) => [row.workspaceId, row.matterHintId])).toEqual([
      [WORKSPACE_ID, '00000000-0000-4000-8000-0000000000aa'],
      [WORKSPACE_ID, '00000000-0000-4000-8000-0000000000aa'],
    ]);
  });

  it('summarises waiting, uploading and failed, and drops stale sent rows', async () => {
    const store = memoryStore();
    const key = await deviceKey();
    const { items } = await enqueueFiles(
      store,
      key,
      [file('a.pdf', '1'), file('b.pdf', '2'), file('c.pdf', '3')],
      { workspaceId: WORKSPACE_ID, channel: 'share', now: 0 },
    );
    await markUploading(store, items[0]!.id);
    await markUploading(store, items[1]!.id);
    await markAttemptFailed(store, items[1]!.id, 'x', 0);
    const rows = await listItems(store, 1_000);
    expect(summarize(rows)).toMatchObject({ waiting: 2, uploading: 1, failed: 0, total: 3, position: 1 });
    await markSent(store, items[0]!.id);
    expect(await listItems(store, 48 * 60 * 60 * 1000)).toHaveLength(2);
  });
});
