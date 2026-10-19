'use client';

// The notification bell's client state (#198): one store per workspace and user, shared by the
// topbar bell, the More-sheet entry and the lazy panel. It loads through the server actions, polls
// every 30 s while the tab is visible and refetches on focus. The last good list is kept in
// sessionStorage, so the badge paints at once and the panel still opens offline (`Showing saved
// notifications`); marking read while offline is applied at once and sent when the browser is back
// online. Also holds whether the panel is open, so `Shift+N` and the More sheet can open it.
import { useEffect, useSyncExternalStore } from 'react';

import {
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type NotificationView,
} from '../../app/(app)/w/[slug]/notifications/actions.ts';

export type { NotificationView };

/** Short polling interval for new notifications. */
export const POLL_INTERVAL_MS = 30_000;

/** Groups are calendar days in India Standard Time, like the rest of the app's dates. */
export const NOTIFICATIONS_TIME_ZONE = 'Asia/Kolkata';

export type NotificationsStatus = 'loading' | 'ready' | 'error' | 'offline';

export interface NotificationsState {
  /** Newest first. */
  items: readonly NotificationView[];
  unread: number;
  status: NotificationsStatus;
  /** Unread ids that arrived with the latest refresh (never on the first load). */
  newIds: readonly string[];
}

export interface NotificationsApi {
  state: NotificationsState;
  refresh: () => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

/** The badge text: nothing at 0, the count to 9, then `9+`. */
export function formatBadge(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 9 ? '9+' : String(unread);
}

const dayKey = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

/** Split newest-first items into `today` and `earlier` by calendar day in `timeZone`. */
export function groupByDay<T extends { createdAt: string }>(
  items: readonly T[],
  now: Date,
  timeZone: string = NOTIFICATIONS_TIME_ZONE,
): { today: T[]; earlier: T[] } {
  const today = dayKey(now, timeZone);
  const sorted = [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return {
    today: sorted.filter((item) => dayKey(new Date(item.createdAt), timeZone) === today),
    earlier: sorted.filter((item) => dayKey(new Date(item.createdAt), timeZone) !== today),
  };
}

const EMPTY: NotificationsState = { items: [], unread: 0, status: 'loading', newIds: [] };

interface Saved {
  items: NotificationView[];
  unread: number;
  /** Ids marked read while offline, not yet sent. */
  queue: string[];
  /** `Mark all read` pressed while offline, not yet sent. */
  markAll: boolean;
}

interface Store {
  workspaceId: string;
  storageKey: string;
  state: NotificationsState;
  listeners: Set<() => void>;
  queue: Set<string>;
  markAll: boolean;
  loaded: boolean;
  inflight: Promise<void> | null;
}

const stores = new Map<string, Store>();
/** The store the mounted bell polls; the More-sheet entry reads its unread count. */
let active: Store | null = null;
/** Told about every change in any store, and when the active store changes. */
const anyListeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readSaved(key: string): Saved | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Saved>;
    if (!Array.isArray(saved.items)) return null;
    return {
      items: saved.items,
      unread: typeof saved.unread === 'number' ? saved.unread : 0,
      queue: Array.isArray(saved.queue) ? saved.queue : [],
      markAll: saved.markAll === true,
    };
  } catch {
    return null;
  }
}

function save(store: Store): void {
  const saved: Saved = {
    items: [...store.state.items],
    unread: store.state.unread,
    queue: [...store.queue],
    markAll: store.markAll,
  };
  try {
    storage()?.setItem(store.storageKey, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the in-memory list still works.
  }
}

function getStore(workspaceId: string, userId: string): Store {
  const storageKey = `cd.notifications.v1:${workspaceId}:${userId}`;
  let store = stores.get(storageKey);
  if (!store) {
    const saved = readSaved(storageKey);
    store = {
      workspaceId,
      storageKey,
      state: saved
        ? { items: saved.items, unread: saved.unread, status: 'ready', newIds: [] }
        : EMPTY,
      listeners: new Set(),
      queue: new Set(saved?.queue ?? []),
      markAll: saved?.markAll ?? false,
      loaded: false,
      inflight: null,
    };
    stores.set(storageKey, store);
  }
  return store;
}

function setState(store: Store, next: Partial<NotificationsState>): void {
  store.state = { ...store.state, ...next };
  for (const listener of store.listeners) listener();
  for (const listener of anyListeners) listener();
}

const isOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;

/** Send reads made while offline; anything still failing stays queued. */
async function flush(store: Store): Promise<void> {
  if (store.markAll) {
    const result = await markAllNotificationsReadAction({ workspaceId: store.workspaceId });
    if (result.ok) {
      store.markAll = false;
      store.queue.clear();
    }
  }
  // Deleting the current entry while iterating a Set is safe.
  for (const id of store.queue) {
    const result = await markNotificationReadAction({
      workspaceId: store.workspaceId,
      notificationId: id,
    });
    // NOT_FOUND (deleted, or no longer visible) is final too.
    if (result.ok || result.error.code === 'NOT_FOUND') store.queue.delete(id);
  }
  save(store);
}

/** Apply reads that are still queued on top of a list from the server. */
function withQueued(store: Store, items: readonly NotificationView[], unread: number) {
  if (!store.markAll && store.queue.size === 0) return { items, unread };
  const readAt = new Date().toISOString();
  let pending = 0;
  const next = items.map((item) => {
    if (item.readAt !== null || !(store.markAll || store.queue.has(item.id))) return item;
    pending += 1;
    return { ...item, readAt };
  });
  return { items: next, unread: store.markAll ? 0 : Math.max(0, unread - pending) };
}

function goOffline(store: Store): void {
  setState(store, { status: store.loaded || store.state.items.length > 0 ? 'offline' : 'error' });
}

function refreshNotifications(store: Store): Promise<void> {
  if (isOffline()) {
    goOffline(store);
    return Promise.resolve();
  }
  store.inflight ??= (async () => {
    try {
      if (store.markAll || store.queue.size > 0) await flush(store);
      const result = await listNotificationsAction({ workspaceId: store.workspaceId });
      if (!result.ok) throw new Error(result.error.code);
      const known = new Set(store.state.items.map((item) => item.id));
      const newIds = store.loaded
        ? result.data.items
            .filter((item) => item.readAt === null && !known.has(item.id))
            .map((item) => item.id)
        : [];
      store.loaded = true;
      setState(store, {
        ...withQueued(store, result.data.items, result.data.unread),
        status: 'ready',
        newIds,
      });
      save(store);
    } catch {
      if (isOffline()) goOffline(store);
      // A failed background poll keeps the list it has; only a list never loaded is an error.
      else if (!store.loaded) setState(store, { status: 'error' });
    } finally {
      store.inflight = null;
    }
  })();
  return store.inflight;
}

function markRead(store: Store, id: string): void {
  const target = store.state.items.find((item) => item.id === id);
  if (!target || target.readAt !== null) return;
  const readAt = new Date().toISOString();
  setState(store, {
    items: store.state.items.map((item) => (item.id === id ? { ...item, readAt } : item)),
    unread: Math.max(0, store.state.unread - 1),
    newIds: store.state.newIds.filter((entry) => entry !== id),
  });
  store.queue.add(id);
  save(store);
  if (!isOffline()) void flush(store).catch(() => undefined);
}

function markAllRead(store: Store): void {
  const readAt = new Date().toISOString();
  setState(store, {
    items: store.state.items.map((item) => (item.readAt === null ? { ...item, readAt } : item)),
    unread: 0,
    newIds: [],
  });
  store.markAll = true;
  save(store);
  if (!isOffline()) void flush(store).catch(() => undefined);
}

/** The shared notifications state for this workspace and user, with its actions. */
export function useNotifications(workspaceId: string, userId: string): NotificationsApi {
  const store = getStore(workspaceId, userId);
  const state = useSyncExternalStore(
    (onChange) => {
      store.listeners.add(onChange);
      return () => {
        store.listeners.delete(onChange);
      };
    },
    () => store.state,
    () => EMPTY,
  );
  return {
    state,
    refresh: () => refreshNotifications(store),
    markRead: (id) => {
      markRead(store, id);
    },
    markAllRead: () => {
      markAllRead(store);
    },
  };
}

/**
 * Keep the store fresh: load on mount, every 30 s while the tab is visible, on focus and when the
 * tab becomes visible, and on reconnect (which also sends reads made offline). Mount it once, in
 * the bell.
 */
export function useNotificationsPolling(workspaceId: string, userId: string): void {
  useEffect(() => {
    const store = getStore(workspaceId, userId);
    active = store;
    for (const listener of anyListeners) listener();
    const refresh = () => {
      void refreshNotifications(store);
    };
    const visible = () => document.visibilityState !== 'hidden';
    const onVisibility = () => {
      if (visible()) refresh();
    };
    const onOffline = () => {
      goOffline(store);
    };
    refresh();
    const timer = window.setInterval(() => {
      if (visible()) refresh();
    }, POLL_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      if (active === store) {
        active = null;
        for (const listener of anyListeners) listener();
      }
    };
  }, [workspaceId, userId]);
}

/** Unread count of the workspace the bell is showing (0 before it mounts). */
export function useActiveUnread(): number {
  return useSyncExternalStore(
    (onChange) => {
      anyListeners.add(onChange);
      return () => {
        anyListeners.delete(onChange);
      };
    },
    () => active?.state.unread ?? 0,
    () => 0,
  );
}

// Whether the panel is open: one bell per shell, opened by a click, `Shift+N` or the More sheet.
let panelOpen = false;
const openListeners = new Set<() => void>();

export function setNotificationsOpen(open: boolean): void {
  if (open === panelOpen) return;
  panelOpen = open;
  for (const listener of openListeners) listener();
}

/** Open the notification panel (the `Shift+N` shortcut and the More-sheet entry). */
export function openNotifications(): void {
  setNotificationsOpen(true);
}

export function useNotificationsOpen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      openListeners.add(onChange);
      return () => {
        openListeners.delete(onChange);
      };
    },
    () => panelOpen,
    () => false,
  );
}

/** Tests only: forget every store and close the panel. */
export function resetNotificationStores(): void {
  stores.clear();
  active = null;
  panelOpen = false;
}
