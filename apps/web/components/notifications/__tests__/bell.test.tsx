// @vitest-environment jsdom
// The bell and its panel (#198): the unread label and `9+` capsule, the lazy panel (popover from
// 768 px, bottom sheet below), Today/Earlier groups newest first, Mark all read, opening an item
// marks it read and closes the panel, keyboard (arrows, R, Esc), the empty and error states, and
// the `Shift+N` shortcut in the shell registry.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createShortcutDispatcher, SHORTCUTS } from '../../../lib/shortcuts/registry.ts';
import {
  mockMatchMedia,
  renderWithIntl,
  stubResizeObserver,
} from '../../shell/__tests__/helpers.tsx';
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
vi.mock('next/navigation', () => ({
  usePathname: () => '/w/chennai-solo/today',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const { Bell, loadNotificationPanel } = await import('../bell.tsx');
const { openNotifications, resetNotificationStores } = await import('../use-notifications.ts');

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-000000000b01';
const NOW = new Date('2026-03-12T09:30:00+05:30');

function note(id: string, createdAt: string, read = false): NotificationView {
  return {
    id,
    category: 'reminder.hearing',
    title: `Hearing tomorrow: W.P. ${id}/2026`,
    body: 'Court 4, item 12',
    href: `/w/chennai-solo/matters/${id}`,
    readAt: read ? createdAt : null,
    createdAt,
  };
}

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const ITEMS = [
  note('101', '2026-03-12T09:00:00+05:30'),
  note('102', '2026-03-12T08:00:00+05:30', true),
  note('103', '2026-03-11T18:00:00+05:30'),
];

const WIDE = '(min-width: 768px)';

async function renderBell() {
  renderWithIntl(<Bell workspaceId={WS} userId={USER} />);
  await act(async () => {
    await loadNotificationPanel();
  });
}

const bell = () => screen.getByRole('button', { name: /^Notifications/ });

async function openPanel() {
  fireEvent.click(bell());
  return screen.findByRole('dialog', { name: 'Notifications' });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetNotificationStores();
  sessionStorage.clear();
  mockMatchMedia({ [WIDE]: true });
  stubResizeObserver();
  actions.list.mockReset().mockImplementation(() => ok({ items: ITEMS, unread: 2 }));
  actions.markOne
    .mockReset()
    .mockImplementation((input: { notificationId: string }) =>
      ok({ notificationId: input.notificationId }),
    );
  actions.markAll.mockReset().mockImplementation(() => ok({ count: 2 }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('notification bell', () => {
  it('labels the unread count and shows it in the capsule', async () => {
    await renderBell();
    await waitFor(() => {
      expect(bell().getAttribute('aria-label')).toBe('Notifications, 2 unread');
    });
    expect(bell().querySelector('[data-notifications-badge]')?.textContent).toBe('2');
    expect(bell().getAttribute('aria-haspopup')).toBe('dialog');
    expect(bell().className).toMatch(/\bmd:size-9\b/);
  });

  it('caps the capsule at 9+ and drops it at zero', async () => {
    actions.list.mockImplementation(() => ok({ items: ITEMS, unread: 12 }));
    await renderBell();
    await waitFor(() => {
      expect(bell().querySelector('[data-notifications-badge]')?.textContent).toBe('9+');
    });
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 12 unread');
    cleanup();
    resetNotificationStores();
    actions.list.mockImplementation(() => ok({ items: [], unread: 0 }));
    await renderBell();
    await waitFor(() => {
      expect(actions.list).toHaveBeenCalled();
    });
    expect(bell().getAttribute('aria-label')).toBe('Notifications');
    expect(bell().querySelector('[data-notifications-badge]')).toBeNull();
  });

  it('opens a popover from 768 px with Today and Earlier groups, newest first', async () => {
    await renderBell();
    const dialog = await openPanel();
    expect(dialog.dataset.notificationPanel).toBe('popover');
    expect(bell().getAttribute('aria-expanded')).toBe('true');
    const today = within(dialog).getByRole('region', { name: 'Today' });
    const earlier = within(dialog).getByRole('region', { name: 'Earlier' });
    const ids = (group: HTMLElement) =>
      [...group.querySelectorAll<HTMLElement>('[data-notification-item]')].map(
        (row) => row.dataset.notificationItem,
      );
    await waitFor(() => {
      expect(ids(today)).toEqual(['101', '102']);
    });
    expect(ids(earlier)).toEqual(['103']);
    // Unread is never colour alone: bold title and a visually hidden label.
    const unread = dialog.querySelector<HTMLElement>('[data-notification-item="101"]');
    expect(unread?.textContent).toContain('Unread: ');
    expect(unread?.querySelector('[data-unread-dot]')).not.toBeNull();
    expect(unread?.getAttribute('href')).toBe('/w/chennai-solo/matters/101');
  });

  it('is a full-height bottom sheet with a drag handle below 768 px', async () => {
    mockMatchMedia({ [WIDE]: false });
    await renderBell();
    const dialog = await openPanel();
    expect(dialog.dataset.notificationPanel).toBe('sheet');
    expect(dialog.dataset.side).toBe('bottom');
    expect(dialog.className).toMatch(/\bh-dvh\b/);
    expect(dialog.querySelector('[data-slot="sheet-handle"]')).not.toBeNull();
  });

  it('opening an item marks it read and closes the panel', async () => {
    await renderBell();
    const dialog = await openPanel();
    const row = await within(dialog).findByText('Hearing tomorrow: W.P. 101/2026');
    fireEvent.click(row);
    expect(actions.markOne).toHaveBeenCalledWith({ workspaceId: WS, notificationId: '101' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    });
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  it('Mark all read clears the badge', async () => {
    await renderBell();
    const dialog = await openPanel();
    const button = within(dialog).getByRole('button', { name: 'Mark all read' });
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(button);
    expect(actions.markAll).toHaveBeenCalledWith({ workspaceId: WS });
    expect(bell().getAttribute('aria-label')).toBe('Notifications');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('moves between rows with the arrow keys, marks read with R and closes with Esc', async () => {
    await renderBell();
    const dialog = await openPanel();
    const rows = await waitFor(() => {
      const found = [...dialog.querySelectorAll<HTMLElement>('[data-notification-item]')];
      expect(found).toHaveLength(3);
      return found;
    });
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
    rows[0]?.focus();
    fireEvent.keyDown(rows[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2] as HTMLElement, { key: 'r' });
    expect(actions.markOne).toHaveBeenCalledWith({ workspaceId: WS, notificationId: '103' });
    fireEvent.keyDown(rows[2] as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    });
  });

  it('shows the calm empty state', async () => {
    actions.list.mockImplementation(() => ok({ items: [], unread: 0 }));
    await renderBell();
    const dialog = await openPanel();
    expect(await within(dialog).findByText('You are all caught up.')).toBeTruthy();
  });

  it('shows the error state with Try again', async () => {
    actions.list.mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: '' } }),
    );
    await renderBell();
    const dialog = await openPanel();
    expect(await within(dialog).findByText('Could not load notifications.')).toBeTruthy();
    const calls = actions.list.mock.calls.length;
    actions.list.mockImplementation(() => ok({ items: ITEMS, unread: 2 }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(actions.list.mock.calls.length).toBe(calls + 1);
    expect(await within(dialog).findByText('Hearing tomorrow: W.P. 101/2026')).toBeTruthy();
  });

  it('opens from outside the bell (Shift+N and the More sheet call openNotifications)', async () => {
    await renderBell();
    act(() => {
      openNotifications();
    });
    expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeTruthy();
  });

  it('keeps the panel out of the bell chunk: only a type import and a dynamic import', () => {
    const source = readFileSync(path.join(import.meta.dirname, '../bell.tsx'), 'utf8');
    const staticImports = [...source.matchAll(/^import (?!type ).*from '([^']+)';$/gm)].map(
      (match) => match[1],
    );
    expect(staticImports).not.toContain('./notification-panel.tsx');
    expect(source).toContain("import('./notification-panel.tsx')");
  });
});

describe('Shift+N shortcut', () => {
  const key = (init: { key: string; shiftKey?: boolean; target?: unknown }) => ({
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  });

  it('opens notifications, but not plain n and not while typing', () => {
    const dispatch = createShortcutDispatcher(SHORTCUTS, { mac: false });
    expect(dispatch(key({ key: 'N', shiftKey: true }))?.id).toBe('action.notifications');
    expect(dispatch(key({ key: 'n' }))).toBeNull();
    expect(dispatch(key({ key: 'N', shiftKey: true, target: { tagName: 'INPUT' } }))).toBeNull();
    const shortcut = SHORTCUTS.find((entry) => entry.action === 'notifications');
    expect(shortcut).toMatchObject({ keys: 'shift+n', labelKey: 'notifications.shortcut' });
  });
});
