'use client';

// The notification panel (#198), in its own chunk: bell.tsx loads it at idle or on first open, so
// the Radix popover and sheet stay out of the shell's initial JS. Below 768 px it is a full-height
// bottom sheet (modal, focus trapped, 250 ms slide); from 768 px a popover anchored to the bell,
// 384 px wide (400 px from 1280 px) and at most 70 vh tall (150 ms fade and rise). Motion tokens
// drop to near zero under prefers-reduced-motion.
import { Button } from '@causedeck/ui/button';
import { useMediaQuery } from '@causedeck/ui/hooks';
import { Popover, PopoverAnchor, PopoverContent } from '@causedeck/ui/popover';
import { Sheet, SheetContent, SheetTitle } from '@causedeck/ui/sheet';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { CircleCheck, CloudOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import { NotificationItem } from './notification-item.tsx';
import {
  groupByDay,
  useNotifications,
  type NotificationView,
  type NotificationsApi,
} from './use-notifications.ts';

export const WIDE_QUERY = '(min-width: 768px)';

export interface NotificationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bell: the popover anchors to it and focus returns to it on close. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  workspaceId: string;
  userId: string;
  /** Footer slot (the push permission card, #197). */
  footer?: ReactNode;
}

export function NotificationPanel({
  open,
  onOpenChange,
  anchorRef,
  workspaceId,
  userId,
  footer,
}: NotificationPanelProps) {
  const t = useTranslations('notifications');
  const wide = useMediaQuery(WIDE_QUERY);
  const api = useNotifications(workspaceId, userId);
  const titleId = useId();

  const returnFocus = (event: Event) => {
    event.preventDefault();
    anchorRef.current?.focus();
  };
  const close = () => {
    onOpenChange(false);
  };

  if (!wide) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          data-notification-panel="sheet"
          aria-describedby={undefined}
          showClose={false}
          onCloseAutoFocus={returnFocus}
          className="h-dvh max-h-dvh gap-0 rounded-none px-0 pt-2 pb-[env(safe-area-inset-bottom)]"
        >
          <PanelBody
            api={api}
            title={
              <SheetTitle className="font-sans text-base font-semibold">{t('title')}</SheetTitle>
            }
            onClose={close}
            footer={footer}
          />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        align="end"
        sideOffset={8}
        role="dialog"
        aria-labelledby={titleId}
        data-notification-panel="popover"
        onCloseAutoFocus={returnFocus}
        onInteractOutside={(event) => {
          // The bell toggles the panel itself; closing here would reopen it on the same click.
          const target = event.target as Node | null;
          if (target && anchorRef.current?.contains(target)) event.preventDefault();
        }}
        className="flex max-h-[70vh] w-[384px] flex-col overflow-hidden p-0 xl:w-[400px]"
      >
        <PanelBody
          api={api}
          title={
            <h2 id={titleId} className="text-ink font-sans text-base font-semibold">
              {t('title')}
            </h2>
          }
          onClose={close}
          footer={footer}
        />
      </PopoverContent>
    </Popover>
  );
}

interface PanelBodyProps {
  api: NotificationsApi;
  title: ReactNode;
  onClose: () => void;
  footer: ReactNode;
}

function PanelBody({ api, title, onClose, footer }: PanelBodyProps) {
  const t = useTranslations('notifications');
  const { state } = api;
  const listRef = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const { today, earlier } = groupByDay(state.items, new Date());
  const ordered = [...today, ...earlier];
  const activeId = ordered.some((item) => item.id === focusedId) ? focusedId : ordered[0]?.id;

  const onOpen = (item: NotificationView) => {
    api.markRead(item.id);
    onClose();
  };

  // Up and Down move between rows (Home and End to the ends); Enter opens; R marks read.
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const rows = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[data-notification-item]') ?? []),
    ];
    if (rows.length === 0) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? rows.length - 1
          : event.key === 'ArrowDown'
            ? Math.min(rows.length - 1, index + 1)
            : Math.max(0, index - 1);
    rows[next]?.focus();
  };

  const group = (key: 'today' | 'earlier', items: NotificationView[]) => {
    if (items.length === 0) return null;
    const headingId = `notifications-group-${key}`;
    return (
      <section key={key} aria-labelledby={headingId}>
        <h3
          id={headingId}
          className="text-eyebrow text-ink-subtle px-4 pt-3 pb-1 font-medium tracking-[0.08em] uppercase"
        >
          {t(`groups.${key}`)}
        </h3>
        <ul className="flex flex-col">
          {items.map((item) => (
            <NotificationItem
              key={item.id}
              item={item}
              isNew={state.newIds.includes(item.id)}
              isToday={key === 'today'}
              tabIndex={item.id === activeId ? 0 : -1}
              onFocus={() => {
                setFocusedId(item.id);
              }}
              onOpen={onOpen}
              onMarkRead={api.markRead}
            />
          ))}
        </ul>
      </section>
    );
  };

  let body: ReactNode;
  if (state.status === 'loading' && state.items.length === 0) {
    body = (
      <SkeletonGroup labels={{ loading: t('loading') }} className="gap-0 py-1">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex min-h-14 items-center gap-3 px-4">
            <Skeleton className="size-8 shrink-0 rounded-[8px]" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </SkeletonGroup>
    );
  } else if (state.status === 'error' && state.items.length === 0) {
    body = (
      <div
        data-pattern-state="error"
        className="flex flex-col items-center gap-3 px-6 py-10 text-center"
      >
        <p className="text-ink text-sm">{t('error')}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void api.refresh();
          }}
        >
          {t('retry')}
        </Button>
      </div>
    );
  } else if (state.items.length === 0) {
    body = (
      <div
        data-pattern-state="empty"
        className="flex flex-col items-center gap-2 px-6 py-10 text-center"
      >
        <CircleCheck aria-hidden="true" className="text-ink-subtle size-6" strokeWidth={1.5} />
        <p className="text-ink-muted text-sm">{t('empty')}</p>
      </div>
    );
  } else {
    body = (
      <div ref={listRef} onKeyDown={onListKeyDown} className="py-1">
        {group('today', today)}
        {group('earlier', earlier)}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line flex min-h-12 shrink-0 items-center justify-between gap-3 border-b ps-4 pe-2">
        {title}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            data-mark-all-read=""
            disabled={state.unread === 0}
            onClick={api.markAllRead}
          >
            {t('markAllRead')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="md:hidden">
            {t('close')}
          </Button>
        </div>
      </div>
      {state.status === 'offline' ? (
        <div
          role="status"
          data-notifications-offline=""
          className="bg-surface-sunken text-ink-muted flex shrink-0 items-center gap-2 px-4 py-2 text-xs"
        >
          <CloudOff aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
          {t('offline')}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      {footer ? <div className="border-line shrink-0 border-t">{footer}</div> : null}
    </div>
  );
}
