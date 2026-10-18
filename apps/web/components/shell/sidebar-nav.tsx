'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';

import { NAV_GROUPS, flagsOff, visibleNavItems, type NavItem } from '../../lib/nav.ts';
import type { FlagKey, Role } from '../../lib/workspace-context.ts';

import { railHidden, railRemoved, useSidebar } from './sidebar-collapse.tsx';
import { useShellOverlays } from './use-shell-overlays.ts';

const INDICATOR = 'bg-accent absolute inset-y-1.5 left-0 w-0.5 rounded-full';

/** Whether `pathname` is `item`'s route or below it (Settings is active on every section). */
export function isNavItemActive(item: NavItem, slug: string, pathname: string): boolean {
  const base = `/w/${encodeURIComponent(slug)}/${item.id}`;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export interface SidebarNavProps {
  slug: string;
  role: Role;
  /** Feature-flag check. TODO(#22): the real evaluator from `@causedeck/flags`. Defaults to off. */
  isEnabled?: ((flag: FlagKey) => boolean) | undefined;
}

/**
 * `nav[aria-label=Primary]` built from the nav manifest. One item is in the tab order (roving
 * tabindex); arrow keys, Home and End move between items. The active item carries
 * `aria-current=page` and a 2 px accent bar that springs between items.
 */
export function SidebarNav({ slug, role, isEnabled = flagsOff }: SidebarNavProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { collapsed } = useSidebar();
  const items = visibleNavItems({ role, isEnabled });
  const active = items.find((entry) => isNavItemActive(entry, slug, pathname));
  const [focused, setFocused] = useState<string | null>(null);
  const tabbable =
    items.find((entry) => entry.id === focused)?.id ?? active?.id ?? items[0]?.id ?? null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-nav-item]')];
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index === -1) return;
    const target = {
      ArrowDown: links[(index + 1) % links.length],
      ArrowUp: links[(index - 1 + links.length) % links.length],
      Home: links[0],
      End: links.at(-1),
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <nav aria-label={t('shell.sidebar.primary')} onKeyDown={onKeyDown}>
      {NAV_GROUPS.map((group) => {
        const groupItems = items.filter((entry) => entry.group === group);
        if (groupItems.length === 0) return null;
        const headingId = `nav-group-${group}`;
        return (
          <div key={group} className="mb-3 flex flex-col gap-0.5">
            <span
              id={headingId}
              className={`text-eyebrow text-ink-subtle px-2.5 pt-2 pb-1 font-medium tracking-[0.08em] uppercase ${railHidden}`}
            >
              {t(`nav.groups.${group}`)}
            </span>
            <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
              {groupItems.map((entry) => (
                <li key={entry.id}>
                  <NavLink
                    item={entry}
                    slug={slug}
                    label={t(entry.labelKey)}
                    isActive={entry.id === active?.id}
                    tabbable={entry.id === tabbable}
                    collapsed={collapsed}
                    onFocus={() => {
                      setFocused(entry.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

interface NavLinkProps {
  item: NavItem;
  slug: string;
  label: string;
  isActive: boolean;
  tabbable: boolean;
  collapsed: boolean;
  onFocus: () => void;
}

function NavLink({ item, slug, label, isActive, tabbable, collapsed, onFocus }: NavLinkProps) {
  const overlays = useShellOverlays();
  const Icon = item.icon;
  const count = item.badge?.();
  const link = (
    <Link
      href={item.href(slug)}
      data-nav-item={item.id}
      data-focus-key={`nav-${item.id}`}
      aria-current={isActive ? 'page' : undefined}
      tabIndex={tabbable ? 0 : -1}
      onFocus={onFocus}
      className={[
        'relative flex h-9 min-w-0 items-center gap-3 rounded-md px-2.5 text-sm font-medium outline-none',
        'focus-visible:outline-ring focus-visible:outline-2',
        'group-data-[sidebar=collapsed]/shell:justify-center group-data-[sidebar=auto]/shell:max-xl:justify-center',
        // 44 px hit target around the 36 px row.
        'before:absolute before:inset-x-0 before:-inset-y-1 before:content-[""]',
        isActive
          ? 'bg-accent-soft text-ink'
          : 'text-ink-muted hover:bg-accent-soft/60 hover:text-ink',
      ].join(' ')}
    >
      {isActive ? (
        overlays ? (
          <overlays.NavActiveIndicator className={INDICATOR} />
        ) : (
          <span data-active-indicator="static" aria-hidden="true" className={INDICATOR} />
        )
      ) : null}
      <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.5} />
      <span className={`min-w-0 flex-1 truncate ${railHidden}`}>{label}</span>
      {item.badge === undefined ? null : (
        <span
          data-badge={item.id}
          className={`text-ink-muted text-xs tabular-nums empty:hidden ${railRemoved}`}
        >
          {count === undefined ? null : count}
        </span>
      )}
    </Link>
  );

  // Rail tooltips arrive with the overlay chunk. The wrapper stays in both states (only `open` is
  // forced off when expanded) so toggling the sidebar never remounts a focused link.
  if (!overlays) return link;
  const { Tooltip, TooltipContent, TooltipTrigger } = overlays;
  return (
    <Tooltip {...(collapsed ? {} : { open: false })}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
