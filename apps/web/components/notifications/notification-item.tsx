'use client';

import {
  Bell,
  CalendarClock,
  Info,
  Newspaper,
  Receipt,
  ShieldAlert,
  Sparkles,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, type KeyboardEvent } from 'react';

import type { NotificationView } from './use-notifications.ts';

interface CategoryStyle {
  icon: LucideIcon;
  /** Soft semantic tile: a `-soft` surface with its matching ink, in both themes. */
  tile: string;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  'workspace.invite': { icon: UserPlus, tile: 'bg-success-soft text-success' },
  'member.joined': { icon: Users, tile: 'bg-success-soft text-success' },
  'security.alert': { icon: ShieldAlert, tile: 'bg-danger-soft text-danger' },
  'billing.notice': { icon: Receipt, tile: 'bg-warning-soft text-warning' },
  'reminder.hearing': { icon: CalendarClock, tile: 'bg-info-soft text-info' },
  'proposal.new': { icon: Sparkles, tile: 'bg-accent-soft text-accent' },
  'digest.daily': { icon: Newspaper, tile: 'bg-info-soft text-info' },
  'system.notice': { icon: Info, tile: 'bg-surface-sunken text-ink-muted' },
};

const FALLBACK_STYLE: CategoryStyle = { icon: Bell, tile: 'bg-surface-sunken text-ink-muted' };

export function categoryStyle(category: string): CategoryStyle {
  return CATEGORY_STYLES[category] ?? FALLBACK_STYLE;
}

export interface NotificationItemProps {
  item: NotificationView;
  /** Arrived with the latest refresh: highlighted, fading over 600 ms. */
  isNew?: boolean;
  /** Earlier days show the date; today shows the time. */
  isToday: boolean;
  /** Roving tab stop: only the focused row is in the tab order. */
  tabIndex: 0 | -1;
  onFocus: () => void;
  /** Opened (click or Enter): mark read, follow `href`, close the panel. */
  onOpen: (item: NotificationView) => void;
  /** `R` on the row. */
  onMarkRead: (id: string) => void;
}

/**
 * One row: 56 px tall, an 8 px-radius category tile, the title (bold while unread), one line of
 * body in muted ink and the time on the right. Unread rows carry a 6 px accent dot, a 40% accent
 * wash and a visually hidden `Unread`, so colour is never the only signal.
 */
export function NotificationItem({
  item,
  isNew = false,
  isToday,
  tabIndex,
  onFocus,
  onOpen,
  onMarkRead,
}: NotificationItemProps) {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const unread = item.readAt === null;
  const { icon: Icon, tile } = categoryStyle(item.category);
  const created = new Date(item.createdAt);
  // The highlight starts on and is switched off after the first frame, so it fades out.
  const [highlight, setHighlight] = useState(isNew);
  useEffect(() => {
    if (!highlight) return;
    const frame = requestAnimationFrame(() => {
      setHighlight(false);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [highlight]);

  const time = isToday
    ? format.dateTime(created, { hour: 'numeric', minute: '2-digit' })
    : format.dateTime(created, { day: 'numeric', month: 'short' });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      onMarkRead(item.id);
    }
  };

  const className = [
    'focus-visible:outline-ring flex min-h-14 w-full items-start gap-3 px-4 py-2.5 text-start outline-none focus-visible:-outline-offset-2 focus-visible:outline-2',
    'transition-colors duration-[600ms] ease-out motion-reduce:transition-none',
    highlight
      ? 'bg-accent-soft'
      : unread
        ? 'bg-accent-soft/40 hover:bg-accent-soft/60'
        : 'hover:bg-surface-sunken',
  ].join(' ');

  const content = (
    <>
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] ${tile}`}
      >
        <Icon className="size-4" strokeWidth={1.5} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span
            className={`text-ink min-w-0 flex-1 truncate font-sans text-sm ${unread ? 'font-semibold' : 'font-medium'}`}
          >
            {unread ? <span className="sr-only">{`${t('unread')}: `}</span> : null}
            {item.title}
          </span>
          <time dateTime={item.createdAt} className="text-ink-muted shrink-0 text-xs tabular-nums">
            {time}
          </time>
        </span>
        {item.body ? <span className="text-ink-muted truncate text-sm">{item.body}</span> : null}
      </span>
      <span className="flex w-1.5 shrink-0 justify-center self-center">
        {unread ? (
          <span
            aria-hidden="true"
            data-unread-dot=""
            className="bg-accent size-1.5 rounded-full forced-colors:bg-[CanvasText]"
          />
        ) : null}
      </span>
    </>
  );

  const shared = {
    'data-notification-item': item.id,
    'data-unread': unread ? '' : undefined,
    tabIndex,
    onFocus,
    onKeyDown,
    className,
  };

  return (
    <li>
      {item.href ? (
        <Link
          href={item.href}
          {...shared}
          onClick={() => {
            onOpen(item);
          }}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          {...shared}
          onClick={() => {
            onOpen(item);
          }}
        >
          {content}
        </button>
      )}
    </li>
  );
}
