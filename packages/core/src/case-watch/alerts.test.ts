import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StatusChanges } from './diff.ts';

const notifyMock = vi.hoisted(() => vi.fn());
const matterRow = vi.hoisted((): { current: unknown } => ({ current: undefined }));

vi.mock('@causedeck/notifications', () => ({ notify: notifyMock }));
vi.mock('@causedeck/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withWorkspace: (_db: unknown, _actor: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({
          innerJoin: () => ({ where: () => Promise.resolve([matterRow.current].filter(Boolean)) }),
        }),
      }),
    }),
}));

const { notifyStatusChanges } = await import('./alerts.ts');

const deps = { db: {} as never, enqueueDelivery: vi.fn() };
const actor = { userId: 'adv-1', workspaceId: 'ws-1' };
const none: StatusChanges = { nextHearingDate: null, stage: null, bench: null, newOrders: [] };
const order = { date: '2026-10-01', number: '4', href: null, summary: null };
const all: StatusChanges = {
  nextHearingDate: { from: '2026-10-01', to: '2026-11-01' },
  stage: { from: 'Arguments', to: 'Judgment' },
  bench: null,
  newOrders: [order],
};
const input = (changes: StatusChanges, firstSnapshot = false) => ({
  snapshotId: 's-1',
  matterId: 'm-1',
  changes,
  firstSnapshot,
});

beforeEach(() => {
  vi.clearAllMocks();
  matterRow.current = { sensitive: false, slug: 'acme' };
});

describe('notifyStatusChanges', () => {
  it('sends one notification per changed kind to the advocate, with a per-snapshot dedupe key', async () => {
    expect(await notifyStatusChanges(deps, actor, input(all))).toBe(3);
    const sent = notifyMock.mock.calls.map(
      ([, n]) => n as { category: string; dedupeKey: string; userId: string; href: string },
    );
    expect(sent.map((n) => n.category)).toEqual([
      'status.next_date',
      'status.order',
      'status.stage',
    ]);
    expect(sent.map((n) => n.dedupeKey)).toEqual([
      'status:s-1:next_date',
      'status:s-1:order',
      'status:s-1:stage',
    ]);
    expect(sent.every((n) => n.userId === 'adv-1' && n.href === '/w/acme/matters/m-1')).toBe(true);
  });

  it('never alerts on the first snapshot, with no change, or on a sensitive matter', async () => {
    expect(await notifyStatusChanges(deps, actor, input(all, true))).toBe(0);
    expect(await notifyStatusChanges(deps, actor, input(none))).toBe(0);
    matterRow.current = { sensitive: true, slug: 'acme' };
    expect(await notifyStatusChanges(deps, actor, input(all))).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('skips a failing notification without failing the others', async () => {
    notifyMock.mockRejectedValueOnce(new Error('enqueue failed'));
    expect(await notifyStatusChanges(deps, actor, input(all))).toBe(2);
  });
});
