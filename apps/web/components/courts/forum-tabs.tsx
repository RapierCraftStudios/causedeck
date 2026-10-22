'use client';

// The forum detail tabs (#400, #42): Halls, Adapter and Links, each its own route, as a nav of links
// with the current one marked `aria-current="page"` (the settings sub-nav pattern). The bar scrolls
// sideways at 360 px. A Rosters link renders when the caller passes `rostersHref`: the forum layout
// links it to the workspace rosters page with the forum selected (`/courts/rosters?forum=<code>`,
// #435). Without it the slot stays hidden.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

export const FORUM_TABS = ['halls', 'adapter', 'links'] as const;

export type ForumTab = (typeof FORUM_TABS)[number] | 'rosters';

/** `/w/<slug>/courts/<code>` plus the tab segment. */
export function forumTabHref(slug: string, code: string, tab: ForumTab): string {
  return `/w/${encodeURIComponent(slug)}/courts/${encodeURIComponent(code)}/${tab}`;
}

const linkClasses = [
  'focus-visible:outline-ring flex min-h-10 items-center border-b-2 border-transparent px-3 text-sm',
  'whitespace-nowrap outline-offset-2 transition-colors duration-150 focus-visible:outline-2',
  'motion-reduce:transition-none text-ink-muted hover:text-ink',
  'aria-[current=page]:border-accent aria-[current=page]:text-ink aria-[current=page]:font-medium',
].join(' ');

function isCurrent(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  const path = decodeURIComponent(pathname);
  const target = decodeURIComponent(href);
  return path === target || path.startsWith(`${target}/`);
}

export interface ForumTabsProps {
  slug: string;
  code: string;
  /** The rosters page with this forum selected (#435); no Rosters tab when omitted. */
  rostersHref?: string | undefined;
}

export function ForumTabs({ slug, code, rostersHref }: ForumTabsProps) {
  const t = useTranslations('courts.detail');
  const pathname = usePathname();
  const tabs: { id: ForumTab; href: string }[] = FORUM_TABS.map((id) => ({
    id,
    href: forumTabHref(slug, code, id),
  }));
  if (typeof rostersHref === 'string') tabs.push({ id: 'rosters', href: rostersHref });

  return (
    <nav aria-label={t('tabsLabel')} data-slot="forum-tabs" className="border-line border-b">
      <ul className="-mb-px flex overflow-x-auto">
        {tabs.map((tab) => (
          <li key={tab.id} className="shrink-0">
            <Link
              href={tab.href}
              data-forum-tab={tab.id}
              aria-current={isCurrent(pathname, tab.href) ? 'page' : undefined}
              className={linkClasses}
            >
              {t(`tabs.${tab.id}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
