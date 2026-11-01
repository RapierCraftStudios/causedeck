import { describe, expect, it } from 'vitest';

import {
  discardQueuedConfirm,
  flushOutcomeConfirms,
  pendingOutcomeConfirms,
  queueOutcomeConfirm,
  type OutcomeConfirmStore,
} from '../../lib/pwa/outbox/outcome-confirms.ts';

function memory() {
  const queue = new Map<string, { id: string; encryptedBlob: Uint8Array }>();
  const store = {
    queue: () => Promise.resolve([...queue.values()] as never[]),
    putQueued: (row: { id: string; encryptedBlob: Uint8Array }) => {
      queue.set(row.id, row);
      return Promise.resolve();
    },
    removeQueued: (id: string) => {
      queue.delete(id);
      return Promise.resolve();
    },
  } as unknown as OutcomeConfirmStore;
  let key: CryptoKey | undefined;
  const keys = {
    get: () => Promise.resolve(key),
    put: (k: CryptoKey) => {
      key = k;
      return Promise.resolve();
    },
  };
  return { store, keys, queue };
}

const confirm = (summary = 'Secret strategy', hearingId = 'h1') => ({
  workspaceId: 'w',
  hearingId,
  payload: { summary, nextDate: { kind: 'none' } },
});

describe('outcome confirm queue', () => {
  it('seals the decision: no plaintext reaches the store', async () => {
    const { store, keys, queue } = memory();
    await queueOutcomeConfirm(store, keys, confirm());
    const row = [...queue.values()][0];
    expect(new TextDecoder().decode(row?.encryptedBlob)).not.toContain('Secret');
    expect(JSON.stringify(row)).not.toContain('Secret');
  });

  it('keeps one row per hearing; the newer decision replaces the older', async () => {
    const { store, keys, queue } = memory();
    await queueOutcomeConfirm(store, keys, confirm('one'));
    await queueOutcomeConfirm(store, keys, confirm('two'));
    await queueOutcomeConfirm(store, keys, confirm('three', 'h2'));
    expect(queue.size).toBe(2);
    const seen: unknown[] = [];
    await flushOutcomeConfirms(
      store,
      keys,
      (c) => {
        seen.push((c.payload as { summary: string }).summary);
        return Promise.resolve({ ok: true });
      },
      { workspaceId: 'w', hearingId: 'h1' },
    );
    expect(seen).toEqual(['two']);
    expect(await pendingOutcomeConfirms(store, 'w')).toBe(1);
  });

  it('removes a row only after the action accepted it', async () => {
    const { store, keys } = memory();
    await queueOutcomeConfirm(store, keys, confirm());
    expect(
      (await flushOutcomeConfirms(store, keys, () => Promise.reject(new Error('offline')))).failed,
    ).toBe(1);
    expect(
      (
        await flushOutcomeConfirms(store, keys, () =>
          Promise.resolve({ ok: false, code: 'INTERNAL' }),
        )
      ).failed,
    ).toBe(1);
    expect(await pendingOutcomeConfirms(store)).toBe(1);
    expect(await flushOutcomeConfirms(store, keys, () => Promise.resolve({ ok: true }))).toEqual({
      sent: 1,
      conflicts: 0,
      failed: 0,
    });
    expect(await pendingOutcomeConfirms(store)).toBe(0);
  });

  it('never overwrites: a conflict stays for the person and is not retried', async () => {
    const { store, keys } = memory();
    await queueOutcomeConfirm(store, keys, confirm());
    expect(
      await flushOutcomeConfirms(store, keys, () =>
        Promise.resolve({ ok: false, code: 'CONFLICT' }),
      ),
    ).toEqual({ sent: 0, conflicts: 1, failed: 0 });
    let calls = 0;
    await flushOutcomeConfirms(store, keys, () => {
      calls++;
      return Promise.resolve({ ok: true });
    });
    expect(calls).toBe(0);
    expect(await pendingOutcomeConfirms(store, 'w', 'conflict')).toBe(1);
  });

  it('marks FORBIDDEN as failed for good, and discard drops a row', async () => {
    const { store, keys } = memory();
    await queueOutcomeConfirm(store, keys, confirm());
    await flushOutcomeConfirms(store, keys, () =>
      Promise.resolve({ ok: false, code: 'FORBIDDEN' }),
    );
    expect(await pendingOutcomeConfirms(store, 'w', 'failed')).toBe(1);
    await discardQueuedConfirm(store, 'w', 'h1');
    expect(await pendingOutcomeConfirms(store, 'w', 'failed')).toBe(0);
  });
});
