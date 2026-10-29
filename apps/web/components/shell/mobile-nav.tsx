'use client';

import { useIsEnabled } from '@causedeck/flags/react';
import { Bell, Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { NAV_GROUPS, visibleNavItems, type NavItem, type WorkspaceRoute } from '../../lib/nav.ts';
import type { FlagKey, Role } from '../../lib/workspace-context.ts';
import { LocaleSwitcher } from '../locale-switcher.tsx';
import {
  formatBadge,
  openNotifications,
  useActiveUnread,
} from '../notifications/use-notifications.ts';

import { CaptureFab } from './capture-fab.tsx';
import { activeNavItem } from './sidebar-nav.tsx';
import { loadShellOverlays, useShellOverlays } from './use-shell-overlays.ts';

/** Destinations with their own slot in the bar; the rest live in the More sheet. */
export const BOTTOM_NAV_ROUTES: readonly WorkspaceRoute[] = [
  'today',
  'inbox',
  'matters',
  'obligations',
];

const SLOT =
  'focus-visible:outline-ring flex h-14 min-h-11 w-full min-w-11 flex-col items-center justify-center gap-1 text-[11px] leading-3 font-medium outline-none focus-visible:outline-2';

const slotTone = (active: boolean) => (active ? 'text-accent' : 'text-ink-muted hover:text-ink');

export interface MobileNavProps {
  slug: string;
  role: Role;
  /** Feature-flag check; defaults to the server-evaluated `FlagsProvider` snapshot (off without one). */
  isEnabled?: ((flag: FlagKey) => boolean) | undefined;
}

/**
 * Phones only (below 768 px, where the sidebar is hidden): a bottom bar 56 px tall plus the
 * safe-area inset, with Today, Inbox, the raised capture button, Matters, Obligations and More.
 * More opens a bottom sheet with Notifications (opening the notification panel), the remaining
 * destinations and the language switcher.
 */
export function MobileNav({ slug, role, isEnabled: isEnabledProp }: MobileNavProps) {
  const fromFlags = useIsEnabled();
  const isEnabled = isEnabledProp ?? fromFlags;
  const t = useTranslations();
  const pathname = usePathname();
  const overlays = useShellOverlays();
  const [moreOpen, setMoreOpen] = useState(false);
  const unread = useActiveUnread();
  const badge = formatBadge(unread);

  const items = visibleNavItems({ role, isEnabled });
  const primary = BOTTOM_NAV_ROUTES.flatMap((id) => items.filter((entry) => entry.id === id));
  const rest = items.filter(
    (entry) => !(BOTTOM_NAV_ROUTES as readonly string[]).includes(entry.id),
  );
  const active = activeNavItem(items, slug, pathname);
  const moreActive = active !== undefined && rest.includes(active);

  const slot = (entry: NavItem) => (
    <li key={entry.id} className="min-w-0">
      <BarLink
        item={entry}
        slug={slug}
        label={t(entry.labelKey)}
        isActive={entry.id === active?.id}
      />
    </li>
  );

  const moreTrigger = (
    <button
      type="button"
      data-mobile-nav-item="more"
      data-focus-key="mobile-more"
      aria-haspopup="dialog"
      aria-expanded={moreOpen}
      aria-current={moreActive ? 'page' : undefined}
      onClick={
        overlays
          ? undefined
          : () => {
              setMoreOpen(true);
              void loadShellOverlays();
            }
      }
      className={`${SLOT} ${slotTone(moreActive)}`}
    >
      <Ellipsis aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.5} />
      <span>{t('shell.mobileNav.more')}</span>
    </button>
  );

  return (
    <nav
      aria-label={t('shell.mobileNav.label')}
      data-mobile-nav=""
      className="bg-surface/95 border-line z-sticky fixed inset-x-0 bottom-0 h-[calc(56px+env(safe-area-inset-bottom))] border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid h-14 grid-cols-6">
        {primary.slice(0, 2).map(slot)}
        <li className="min-w-0">
          <CaptureFab />
        </li>
        {primary.slice(2).map(slot)}
        <li className="min-w-0">
          {overlays ? (
            <overlays.Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <overlays.SheetTrigger asChild>{moreTrigger}</overlays.SheetTrigger>
              <overlays.SheetContent
                side="bottom"
                data-more-sheet=""
                aria-describedby={undefined}
                labels={{ close: t('shell.sheet.close') }}
                className="overflow-y-auto"
              >
                <overlays.SheetHeader>
                  <overlays.SheetTitle>{t('shell.mobileNav.moreTitle')}</overlays.SheetTitle>
                </overlays.SheetHeader>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    data-more-item="notifications"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setMoreOpen(false);
                      openNotifications();
                    }}
                    className="focus-visible:outline-ring text-ink-muted hover:bg-accent-soft/60 hover:text-ink flex min-h-11 items-center gap-3 rounded-md px-2 text-start text-sm font-medium outline-none focus-visible:outline-2"
                  >
                    <Bell aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.5} />
                    <span className="flex-1">{t('notifications.title')}</span>
                    {badge ? (
                      <>
                        <span
                          aria-hidden="true"
                          className="bg-accent text-accent-ink flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums"
                        >
                          {badge}
                        </span>
                        <span className="sr-only">
                          {t('notifications.unreadCount', { count: unread })}
                        </span>
                      </>
                    ) : null}
                  </button>
                  {NAV_GROUPS.map((group) => {
                    const groupItems = rest.filter((entry) => entry.group === group);
                    if (groupItems.length === 0) return null;
                    const headingId = `more-group-${group}`;
                    return (
                      <div key={group} className="flex flex-col gap-0.5">
                        <span
                          id={headingId}
                          className="text-eyebrow text-ink-subtle px-2 pb-1 font-medium tracking-[0.08em] uppercase"
                        >
                          {t(`nav.groups.${group}`)}
                        </span>
                        <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
                          {groupItems.map((entry) => {
                            const Icon = entry.icon;
                            const isActive = entry.id === active?.id;
                            return (
                              <li key={entry.id}>
                                <Link
                                  href={entry.href(slug)}
                                  data-more-item={entry.id}
                                  aria-current={isActive ? 'page' : undefined}
                                  onClick={() => {
                                    setMoreOpen(false);
                                  }}
                                  className={[
                                    'focus-visible:outline-ring flex min-h-11 items-center gap-3 rounded-md px-2 text-sm font-medium outline-none focus-visible:outline-2',
                                    isActive
                                      ? 'bg-accent-soft text-ink'
                                      : 'text-ink-muted hover:bg-accent-soft/60 hover:text-ink',
                                  ].join(' ')}
                                >
                                  <Icon
                                    aria-hidden="true"
                                    className="size-[18px] shrink-0"
                                    strokeWidth={1.5}
                                  />
                                  {t(entry.labelKey)}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                  <LocaleSwitcher variant="list" />
                </div>
              </overlays.SheetContent>
            </overlays.Sheet>
          ) : (
            moreTrigger
          )}
        </li>
      </ul>
    </nav>
  );
}

interface BarLinkProps {
  item: NavItem;
  slug: string;
  label: string;
  isActive: boolean;
}

function BarLink({ item, slug, label, isActive }: BarLinkProps) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href(slug)}
      data-mobile-nav-item={item.id}
      aria-current={isActive ? 'page' : undefined}
      className={`${SLOT} ${slotTone(isActive)}`}
    >
      <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.5} />
      {/* Tamil labels run wider than the 60 px slot at 360 px: one step smaller, no padding (#176). */}
      <span className="max-w-full truncate px-0.5 [&:lang(ta)]:px-0 [&:lang(ta)]:text-[10px]">
        {label}
      </span>
    </Link>
  );
}
