'use client';
// The matter workspace's tab bar (#390): the tabs from the registry (lib/matters/tab-registry.ts)
// the member's role may see, as `role="tablist"` links with `role="tab"`, `aria-selected` and a
// roving tabindex. Left/Right move between tabs (wrapping), Home/End jump to the ends, Enter or a
// click opens the tab. The content below is the `tabpanel` labelled by the active tab. On phones
// the strip scrolls sideways with snap; each tab is at least 44 px tall.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from './matter-card.tsx';

export interface MatterTabEntry {
  id: string;
  href: string;
  label: string;
}

export interface MatterTabsProps {
  entries: MatterTabEntry[];
  label: string;
  children: ReactNode;
}

/** The active tab: the longest href the path starts with (Overview is the bare matter path). */
export function activeTabId(entries: readonly MatterTabEntry[], pathname: string): string | null {
  let best: MatterTabEntry | null = null;
  for (const entry of entries) {
    const match = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
    if (match && (best === null || entry.href.length > best.href.length)) best = entry;
  }
  return best?.id ?? entries[0]?.id ?? null;
}

export function MatterTabs({ entries, label, children }: MatterTabsProps) {
  const pathname = usePathname();
  const active = activeTabId(entries, pathname);
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    const last = entries.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
  }

  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        data-matter-tabs=""
        className="border-line flex snap-x gap-1 overflow-x-auto border-b"
      >
        {entries.map((entry, index) => {
          const selected = entry.id === active;
          return (
            <Link
              key={entry.id}
              ref={(node) => {
                refs.current[index] = node;
              }}
              href={entry.href}
              role="tab"
              id={`matter-tab-${entry.id}`}
              aria-selected={selected}
              aria-controls="matter-tabpanel"
              tabIndex={selected ? 0 : -1}
              data-matter-tab={entry.id}
              onKeyDown={(event) => {
                onKeyDown(event, index);
              }}
              className={cn(
                'focus-visible:outline-ring -mb-px flex min-h-11 shrink-0 snap-start items-center border-b-2 px-3 text-sm outline-none focus-visible:outline-2',
                selected
                  ? 'border-accent text-ink font-medium'
                  : 'text-ink-muted hover:text-ink border-transparent',
              )}
            >
              {entry.label}
            </Link>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id="matter-tabpanel"
        aria-labelledby={active === null ? undefined : `matter-tab-${active}`}
        data-matter-tabpanel=""
        className="flex min-w-0 flex-col gap-6 pt-6"
      >
        {children}
      </div>
    </>
  );
}
