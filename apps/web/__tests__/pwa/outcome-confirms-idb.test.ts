import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import {
  browserOutcomeConfirmStores,
  flushOutcomeConfirms,
  pendingOutcomeConfirms,
  queueOutcomeConfirm,
} from '../../lib/pwa/outbox/outcome-confirms.ts';

describe('outcome confirm queue on IndexedDB', () => {
  it('queues and flushes through the real Dexie stores', async () => {
    const { store, keys } = await browserOutcomeConfirmStores();
    await queueOutcomeConfirm(store, keys, {
      workspaceId: 'w',
      hearingId: 'h',
      payload: { summary: 'Adjourned', nextDate: { kind: 'none' } },
    });
    expect(await pendingOutcomeConfirms(store, 'w')).toBe(1);
    const seen: unknown[] = [];
    const result = await flushOutcomeConfirms(store, keys, (c) => {
      seen.push(c.payload);
      return Promise.resolve({ ok: true });
    });
    expect(result.sent).toBe(1);
    expect(seen).toEqual([{ summary: 'Adjourned', nextDate: { kind: 'none' } }]);
  });
});
