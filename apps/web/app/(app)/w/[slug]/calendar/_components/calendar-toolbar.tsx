'use client';

// The calendar toolbar (#66): range navigation, week/month and Mine/Whole chamber toggles, and the
// keyboard shortcuts t (today), w / m (view), [ and ] (previous and next range). The hrefs are
// computed by the page so the same links work without script.
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export interface ToolbarLinks {
  previous: string;
  next: string;
  today: string;
  week: string;
  month: string;
  mine: string;
  workspace: string;
}

export function CalendarToolbar({
  links,
  view,
  scope,
  canViewAll,
  from,
  to,
}: {
  links: ToolbarLinks;
  view: 'week' | 'month';
  scope: 'mine' | 'workspace';
  canViewAll: boolean;
  from: string;
  to: string;
}) {
  const t = useTranslations('calendarView');
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const href = {
        t: links.today,
        w: links.week,
        m: links.month,
        '[': links.previous,
        ']': links.next,
      }[e.key];
      if (href === undefined) return;
      e.preventDefault();
      router.push(href);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [links, router]);
  const item = (href: string, label: string, current?: boolean) => (
    <a
      href={href}
      aria-current={current === true ? 'true' : undefined}
      className={`border-line rounded-md border px-3 py-1.5 text-sm ${current === true ? 'bg-surface-sunken font-medium' : ''}`}
    >
      {label}
    </a>
  );
  return (
    <nav
      aria-label={t('toolbar.label')}
      data-slot="calendar-toolbar"
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        {item(links.previous, t('toolbar.previous'))}
        {item(links.today, t('toolbar.today'))}
        {item(links.next, t('toolbar.next'))}
        <span className="text-sm">{t('toolbar.range', { from, to })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span role="group" aria-label={t('views.label')} className="flex gap-1">
          {item(links.week, t('views.week'), view === 'week')}
          {item(links.month, t('views.month'), view === 'month')}
        </span>
        {canViewAll ? (
          <span role="group" aria-label={t('scope.label')} className="flex gap-1">
            {item(links.mine, t('scope.mine'), scope === 'mine')}
            {item(links.workspace, t('scope.workspace'), scope === 'workspace')}
          </span>
        ) : null}
      </div>
      <p className="text-ink-muted text-xs">{t('toolbar.shortcuts')}</p>
    </nav>
  );
}

/** Shown while the browser is offline: the range is as last loaded (#65's cache is not yet there). */
export function OfflineNotice() {
  const t = useTranslations('calendarView');
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  if (online) return null;
  return (
    <p
      role="status"
      data-pattern-state="offline"
      className="border-line rounded-md border border-dashed p-2 text-sm"
    >
      {t('offline')}
    </p>
  );
}
