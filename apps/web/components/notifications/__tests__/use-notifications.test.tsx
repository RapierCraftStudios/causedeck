// @vitest-environment jsdom
// The notification store (#198): badge cap, Today/Earlier in IST, 30 s polling and focus refetch,
// new-item detection, and mark-read queued while offline and sent on reconnect.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationView } from '../use-notifications.ts';

const actions = vi.hoisted(() => ({
  list: vi.fn(),
  markOne: vi.fn(),
  markAll: vi.fn(),
}));
vi.mock('../../../app/(app)/w/[slug]/notifications/actions.ts', () => ({
  listNotificationsAction: actions.list,
  markNotificationReadAction: actions.markOne,
  markAllNotificationsReadAction: actions.markAll,
}));

const {
  POLL_INTERVAL_MS,
  formatBadge,
  groupByDay,
  resetNotificationStores,
  useNotifications,
  useNotificationsPolling,
} = await import('../use-notifications.ts');

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000000u1';

function note(id: string, createdAt: string, read = false): NotificationView {
  return {
    id,
    category: 'reminder.hearing',
    title: `Hearing ${id}`,
    body: null,
    href: `/w/chennai-solo/matters`,
    readAt: read ? createdAt : null,
    createdAt,
  };
}

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

/** Mount the store with polling, as the bell does. */
function mount() {
  return renderHook(() => {
    useNotificationsPolling(WS, USER);
    return useNotifications(WS, USER);
  });
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  resetNotificationStores();
  sessionStorage.clear();
  setOnline(true);
  actions.list.mockReset();
  actions.markOne
    .mockReset()
    .mockImplementation((input: { notificationId: string }) =>
      ok({ notificationId: input.notificationId }),
    );
  actions.markAll.mockReset().mockImplementation(() => ok({ count: 1 }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('formatBadge', () => {
  it('shows nothing at zero, the count to 9, then 9+', () => {
    expect(formatBadge(0)).toBeNull();
    expect(formatBadge(1)).toBe('1');
    expect(formatBadge(3)).toBe('3');
    expect(formatBadge(9)).toBe('9');
    expect(formatBadge(10)).toBe('9+');
    expect(formatBadge(250)).toBe('9+');
  });
});

describe('groupByDay', () => {
  it('splits by the calendar day in India Standard Time, newest first', () => {
    // 00:10 IST on 12 March is still 11 March in UTC.
    const now = new Date('2026-03-12T00:10:00+05:30');
    const items = [
      note('b', '2026-03-11T23:50:00+05:30'),
      note('a', '2026-03-12T00:05:00+05:30'),
      note('c', '2026-03-12T00:01:00+05:30'),
      note('d', '2026-03-01T09:00:00+05:30'),
    ];
    const { today, earlier } = groupByDay(items, now);
    expect(today.map((item) => item.id)).toEqual(['a', 'c']);
    expect(earlier.map((item) => item.id)).toEqual(['b', 'd']);
  });
});

describe('useNotifications', () => {
  it('loads on mount, polls every 30 s and refetches on focus', async () => {
    vi.useFakeTimers();
    actions.list.mockImplementation(() =>
      ok({ items: [note('a', '2026-03-12T09:00:00+05:30')], unread: 1 }),
    );
    const { result } = mount();
    await flush();
    expect(actions.list).toHaveBeenCalledTimes(1);
    expect(actions.list).toHaveBeenLastCalledWith({ workspaceId: WS });
    expect(result.current.state.status).toBe('ready');
    expect(result.current.state.unread).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    });
    expect(actions.list).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(actions.list).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(actions.list).toHaveBeenCalledTimes(3);
    expect(POLL_INTERVAL_MS).toBe(30_000);
  });

  it('flags unread items that arrive after the first load as new', async () => {
    actions.list.mockImplementationOnce(() =>
      ok({ items: [note('a', '2026-03-12T09:00:00+05:30')], unread: 1 }),
    );
    const { result } = mount();
    await flush();
    expect(result.current.state.newIds).toEqual([]);

    actions.list.mockImplementationOnce(() =>
      ok({
        items: [note('b', '2026-03-12T09:10:00+05:30'), note('a', '2026-03-12T09:00:00+05:30')],
        unread: 2,
      }),
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state.newIds).toEqual(['b']);
    expect(result.current.state.unread).toBe(2);
  });

  it('marks read optimistically and through the action', async () => {
    actions.list.mockImplementation(() =>
      ok({
        items: [note('a', '2026-03-12T09:00:00+05:30'), note('b', '2026-03-12T08:00:00+05:30')],
        unread: 2,
      }),
    );
    const { result } = mount();
    await flush();
    act(() => {
      result.current.markRead('a');
    });
    expect(result.current.state.unread).toBe(1);
    expect(result.current.state.items.find((item) => item.id === 'a')?.readAt).not.toBeNull();
    await flush();
    expect(actions.markOne).toHaveBeenCalledWith({ workspaceId: WS, notificationId: 'a' });

    act(() => {
      result.current.markAllRead();
    });
    expect(result.current.state.unread).toBe(0);
    await flush();
    expect(actions.markAll).toHaveBeenCalledWith({ workspaceId: WS });
  });

  it('shows an error only when nothing has loaded, and keeps the list on a failed poll', async () => {
    actions.list.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: '' } }),
    );
    const { result } = mount();
    await flush();
    expect(result.current.state.status).toBe('error');

    actions.list.mockImplementationOnce(() =>
      ok({ items: [note('a', '2026-03-12T09:00:00+05:30')], unread: 1 }),
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state.status).toBe('ready');

    actions.list.mockImplementationOnce(() => Promise.reject(new Error('network')));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state.status).toBe('ready');
    expect(result.current.state.items).toHaveLength(1);
  });

  it('offline: shows the saved list, queues mark-read and sends it on reconnect', async () => {
    actions.list.mockImplementation(() =>
      ok({ items: [note('a', '2026-03-12T09:00:00+05:30')], unread: 1 }),
    );
    const first = mount();
    await flush();
    first.unmount();

    // A new page load while offline paints from sessionStorage.
    resetNotificationStores();
    setOnline(false);
    const { result } = mount();
    await flush();
    expect(actions.list).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('offline');
    expect(result.current.state.items.map((item) => item.id)).toEqual(['a']);

    act(() => {
      result.current.markRead('a');
    });
    expect(result.current.state.unread).toBe(0);
    await flush();
    expect(actions.markOne).not.toHaveBeenCalled();

    setOnline(true);
    actions.list.mockImplementation(() =>
      ok({ items: [note('a', '2026-03-12T09:00:00+05:30', true)], unread: 0 }),
    );
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    await flush();
    expect(actions.markOne).toHaveBeenCalledWith({ workspaceId: WS, notificationId: 'a' });
    expect(result.current.state.status).toBe('ready');
    expect(result.current.state.unread).toBe(0);
  });
});
