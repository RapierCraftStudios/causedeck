import { afterEach, describe, expect, it, vi } from 'vitest';

import { dataSaverOn, syncOutbox } from '../../lib/pwa/outbox/sync.ts';
import { enqueueFiles } from '../../lib/pwa/outbox/queue.ts';

import { deviceKey, file, memoryStore, WORKSPACE_ID } from './helpers.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function okFetch() {
  return vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/presign')) {
      return Promise.resolve(
        Response.json(
          { captureId: 'c1', uploadUrl: 'https://s.example.test/p', headers: { 'content-type': 'application/pdf' } },
          { status: 201 },
        ),
      );
    }
    if (url.endsWith('/complete')) return Promise.resolve(Response.json({ status: 'queued' }));
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

async function waiting(options: { workspaceId: string | null } = { workspaceId: WORKSPACE_ID }) {
  const store = memoryStore();
  const key = await deviceKey();
  await enqueueFiles(store, key, [file('a.pdf', 'abc')], { ...options, channel: 'share' });
  return { store, key };
}

describe('outbox sync triggers (#50)', () => {
  it('reads navigator.connection.saveData', () => {
    expect(dataSaverOn({ connection: { saveData: true } })).toBe(true);
    expect(dataSaverOn({ connection: { saveData: false } })).toBe(false);
    expect(dataSaverOn({})).toBe(false);
  });

  it('uploads nothing on its own while data saver is on', async () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const { store, key } = await waiting();
    const send = okFetch();
    const result = await syncOutbox({ store, key, fetch: send });
    expect(result).toMatchObject({ attempted: 0, skippedForDataSaver: true });
    expect(send).not.toHaveBeenCalled();
    expect([...store.rows.values()][0]?.state).toBe('queued');
  });

  it('"Upload now" ignores data saver', async () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const { store, key } = await waiting();
    const result = await syncOutbox({ store, key, fetch: okFetch(), manual: true });
    expect(result.outcomes).toEqual(['sent']);
  });

  it('uploads when data saver is off and leaves items with no workspace alone', async () => {
    vi.stubGlobal('navigator', { connection: { saveData: false } });
    const { store, key } = await waiting({ workspaceId: null });
    const send = okFetch();
    expect(await syncOutbox({ store, key, fetch: send })).toMatchObject({ attempted: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('waits out a backoff unless the person taps Upload now', async () => {
    vi.stubGlobal('navigator', {});
    const { store, key } = await waiting();
    const [row] = await store.all();
    await store.put({ ...row!, nextAttemptAt: 50_000 });
    const send = okFetch();
    const early = await syncOutbox({ store, key, fetch: send, now: () => 10_000 });
    expect(early).toMatchObject({ attempted: 0, nextAt: 50_000 });
    const manual = await syncOutbox({ store, key, fetch: send, now: () => 10_000, manual: true });
    expect(manual.outcomes).toEqual(['sent']);
  });
});
