'use client';
// The settings sub-nav (#284, #25 design spec). Under 768 px a horizontally scrollable segmented
// list pinned under the topbar, its edges faded while more entries are off screen; from 768 px a
// sticky vertical list (200 px, 220 px from 1280). Entries come from `lib/settings-nav.ts`, already
// filtered by `can()` on the server; the current section is marked `aria-current="page"`.
import { classNames as cn } from './setting-section.tsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SettingsNavEntry {
  id: string;
  href: string;
  label: string;
  group: 'sections' | 'more';
}

export interface SettingsNavProps {
  entries: readonly SettingsNavEntry[];
  /** Accessible name of the nav landmark (`Settings sections`). */
  label: string;
  /** Heading of the secondary group (`More`). */
  moreLabel: string;
}

const linkClasses = [
  'focus-visible:outline-ring flex min-h-9 items-center rounded-md px-3 text-sm whitespace-nowrap',
  'outline-offset-2 transition-colors duration-150 focus-visible:outline-2 motion-reduce:transition-none',
  'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  'aria-[current=page]:bg-surface-sunken aria-[current=page]:text-ink aria-[current=page]:font-medium',
].join(' ');

function isCurrent(pathname: string | null, href: string): boolean {
  return pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));
}

export function SettingsNav({ entries, label, moreLabel }: SettingsNavProps) {
  const pathname = usePathname();
  const sections = entries.filter((entry) => entry.group === 'sections');
  const more = entries.filter((entry) => entry.group === 'more');

  const item = (entry: SettingsNavEntry) => (
    <li key={entry.id} className="shrink-0">
      <Link
        href={entry.href}
        data-settings-nav={entry.id}
        aria-current={isCurrent(pathname, entry.href) ? 'page' : undefined}
        className={linkClasses}
      >
        {entry.label}
      </Link>
    </li>
  );

  return (
    <nav
      aria-label={label}
      data-slot="settings-nav"
      className={cn(
        // 360: a segmented strip pinned under the topbar, scrolling sideways with faded edges.
        'bg-surface sticky top-0 z-10 -mx-4 px-4 py-2 md:mx-0 md:px-0 md:py-0',
        'md:top-4 md:self-start md:bg-transparent',
      )}
    >
      <div
        className={cn(
          '[scrollbar-width:none] overflow-x-auto overscroll-x-contain md:overflow-visible',
          '[mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)]',
          'md:[mask-image:none]',
        )}
      >
        <ul className="flex gap-1 px-2 md:flex-col md:px-0">
          {sections.map(item)}
          {more.length > 0 ? (
            <li className="shrink-0 md:mt-4" aria-hidden="true">
              <span className="text-ink-subtle hidden px-3 text-xs font-medium uppercase md:block">
                {moreLabel}
              </span>
              <span className="bg-line mx-1 block h-full w-px md:hidden" />
            </li>
          ) : null}
          {more.map(item)}
        </ul>
      </div>
    </nav>
  );
}
