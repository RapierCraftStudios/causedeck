'use client';

// The topbar notification bell (#198): a 36 px icon button (44 px tap target on phones) with the
// unread count as a 16 px accent capsule, capped at `9+`. It mounts the polling, announces new
// notifications politely, and loads the panel chunk (notification-panel.tsx) at idle or on first
// open, so the shell's initial JS carries only this button.
import { Bell as BellIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import type * as PanelModule from './notification-panel.tsx';
import {
  formatBadge,
  setNotificationsOpen,
  useNotifications,
  useNotificationsOpen,
  useNotificationsPolling,
} from './use-notifications.ts';

export type NotificationPanelComponent = typeof PanelModule.NotificationPanel;

let loaded: NotificationPanelComponent | null = null;
let pending: Promise<NotificationPanelComponent> | null = null;
const listeners = new Set<() => void>();

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};

/**
 * Load the panel chunk (once) and re-render every bell waiting for it. A failed load (offline
 * before the chunk arrived) is forgotten, so the next open tries again.
 */
export function loadNotificationPanel(): Promise<NotificationPanelComponent> {
  pending ??= import('./notification-panel.tsx').then(
    (mod) => {
      loaded = mod.NotificationPanel;
      for (const notify of listeners) notify();
      return mod.NotificationPanel;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => {
      window.cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(run, 200);
  return () => {
    window.clearTimeout(id);
  };
}

/** The panel component, or `null` until its chunk has loaded. */
function useNotificationPanel(open: boolean): { Panel: NotificationPanelComponent | null } {
  const Panel = useSyncExternalStore(
    subscribe,
    () => loaded,
    () => null,
  );
  useEffect(
    () =>
      whenIdle(() => {
        void loadNotificationPanel().catch(() => undefined);
      }),
    [],
  );
  useEffect(() => {
    if (open) void loadNotificationPanel().catch(() => undefined);
  }, [open]);
  return { Panel };
}

export interface BellProps {
  workspaceId: string;
  userId: string;
}

export function Bell({ workspaceId, userId }: BellProps) {
  const t = useTranslations('notifications');
  const { state } = useNotifications(workspaceId, userId);
  useNotificationsPolling(workspaceId, userId);
  const open = useNotificationsOpen();
  const { Panel } = useNotificationPanel(open);
  const ref = useRef<HTMLButtonElement>(null);
  const badge = formatBadge(state.unread);
  const label = state.unread > 0 ? t('bell.labelUnread', { count: state.unread }) : t('bell.label');

  return (
    <>
      <button
        ref={ref}
        type="button"
        data-notifications-bell=""
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setNotificationsOpen(!open);
        }}
        className="text-ink-muted hover:text-ink hover:bg-surface-sunken focus-visible:outline-ring relative flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:outline-2 md:size-9"
      >
        <BellIcon aria-hidden="true" className="size-[18px]" strokeWidth={1.5} />
        {badge ? (
          <span
            aria-hidden="true"
            data-notifications-badge=""
            className="bg-accent text-accent-ink ring-surface absolute end-1 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2 md:-end-0.5 md:-top-0.5"
          >
            {badge}
          </span>
        ) : null}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state.newIds.length > 0 ? t('announce', { count: state.newIds.length }) : ''}
      </span>
      {Panel ? (
        <Panel
          open={open}
          onOpenChange={setNotificationsOpen}
          anchorRef={ref}
          workspaceId={workspaceId}
          userId={userId}
        />
      ) : null}
    </>
  );
}
