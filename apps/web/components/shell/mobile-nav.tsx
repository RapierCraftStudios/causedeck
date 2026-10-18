'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  NAV_GROUPS,
  flagsOff,
  visibleNavItems,
  type NavItem,
  type WorkspaceRoute,
} from '../../lib/nav.ts';
import type { FlagKey, Role } from '../../lib/workspace-context.ts';

import { CaptureFab } from './capture-fab.tsx';
import { isNavItemActive } from './sidebar-nav.tsx';
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
  /** Feature-flag check. TODO(#22): the real evaluator from `@causedeck/flags`. Defaults to off. */
  isEnabled?: ((flag: FlagKey) => boolean) | undefined;
}

/**
 * Phones only (below 768 px, where the sidebar is hidden): a bottom bar 56 px tall plus the
 * safe-area inset, with Today, Inbox, the raised capture button, Matters, Obligations and More.
 * More opens a bottom sheet with the remaining destinations.
 */
export function MobileNav({ slug, role, isEnabled = flagsOff }: MobileNavProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const overlays = useShellOverlays();
  const [moreOpen, setMoreOpen] = useState(false);

  const items = visibleNavItems({ role, isEnabled });
  const primary = BOTTOM_NAV_ROUTES.flatMap((id) => items.filter((entry) => entry.id === id));
  const rest = items.filter((entry) => !BOTTOM_NAV_ROUTES.includes(entry.id));
  const active = items.find((entry) => isNavItemActive(entry, slug, pathname));
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
      <span className="max-w-full truncate px-0.5">{label}</span>
    </Link>
  );
}
