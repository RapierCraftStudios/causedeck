'use client';

// The courts index (#399): enabled forums by city then court in one keyboard grid, and the planned
// (disabled) forums apart with their reason and no links. The grid has a single tab stop (roving
// tabindex): arrow keys move across cards, Home/End jump to the ends and Enter opens the forum. The
// search field carries `data-page-search`, so the shell's `/` shortcut focuses it.
import type { CourtsIndex, CourtsIndexForum, DisabledForum } from '@causedeck/core/court';
import { Input } from '@causedeck/ui/input';
import { ErrorState } from '@causedeck/ui/patterns';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type KeyboardEvent } from 'react';

import { ForumCard, forumHref, forumName, scriptLang } from './forum-card.tsx';

export interface ForumListProps {
  index: CourtsIndex;
  slug: string;
}

function matches(
  forum: Pick<CourtsIndexForum, 'code' | 'court' | 'establishment' | 'seat'>,
  query: string,
): boolean {
  if (query === '') return true;
  return [forum.court, forum.establishment, forum.seat, forum.code].some(
    (field) => field !== null && field.toLowerCase().includes(query),
  );
}

/** The index narrowed to forums matching `query` (lower-cased), dropping empty groups. */
export function filterIndex(index: CourtsIndex, query: string): CourtsIndex {
  return {
    cities: index.cities
      .map((city) => ({
        city: city.city,
        courts: city.courts
          .map((court) => ({
            court: court.court,
            forums: court.forums.filter((f) => matches(f, query)),
          }))
          .filter((court) => court.forums.length > 0),
      }))
      .filter((city) => city.courts.length > 0),
    disabled: index.disabled.filter((f) => matches(f, query)),
  };
}

/**
 * Cards per visual row in the card's grid row: the cells sharing the first cell's top edge. One when
 * there is no layout (jsdom), so Up and Down still move.
 */
function columnsOf(link: HTMLElement | null): number {
  const row = link?.closest('[role="row"]');
  if (!row) return 1;
  const cells = [...row.querySelectorAll<HTMLElement>('[role="gridcell"]')];
  const rects = cells.map((cell) => cell.getBoundingClientRect());
  const first = rects[0];
  if (first === undefined || rects.every((rect) => rect.width === 0)) return 1;
  return Math.max(1, rects.filter((rect) => Math.abs(rect.top - first.top) < 1).length);
}

export function ForumList({ index, slug }: ForumListProps) {
  const t = useTranslations('courts');
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const plannedId = useId();

  const needle = query.trim().toLowerCase();
  const shown = filterIndex(index, needle);
  const order = shown.cities.flatMap((city) => city.courts.flatMap((court) => court.forums));
  const activeIndex = Math.max(
    0,
    order.findIndex((f) => f.code === activeCode),
  );

  const focusAt = (position: number) => {
    const target = order[Math.min(order.length - 1, Math.max(0, position))];
    if (target === undefined) return;
    setActiveCode(target.code);
    links.current.get(target.code)?.focus();
  };

  const onKeyDown = (position: number, forum: CourtsIndexForum) => (event: KeyboardEvent) => {
    const columns = () => columnsOf(links.current.get(forum.code) ?? null);
    switch (event.key) {
      case 'ArrowRight':
        focusAt(position + 1);
        break;
      case 'ArrowLeft':
        focusAt(position - 1);
        break;
      case 'ArrowDown':
        focusAt(position + columns());
        break;
      case 'ArrowUp':
        focusAt(position - columns());
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(order.length - 1);
        break;
      case 'Enter':
        router.push(forumHref(slug, forum.code));
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const positionOf = new Map(order.map((forum, at) => [forum.code, at]));
  return (
    <div data-slot="forum-list" className="flex flex-col gap-8">
      <Input
        type="search"
        data-page-search=""
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        className="max-w-md"
      />
      {order.length === 0 && needle !== '' ? (
        <p data-forum-no-match="" className="text-ink-muted text-sm">
          {t('search.noMatch', { query: query.trim() })}
        </p>
      ) : null}
      {order.length > 0 ? (
        <div role="grid" aria-label={t('gridLabel')} className="flex flex-col gap-6">
          {shown.cities.map((city) =>
            city.courts.map((court, courtIndex) => (
              <div
                key={`${city.city ?? ''}|${court.court}`}
                role="row"
                data-court-row={court.court}
                className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
              >
                <div role="rowheader" className="col-span-full flex flex-col gap-1">
                  {courtIndex === 0 ? (
                    <h2 data-city={city.city ?? ''} className="font-serif text-xl font-medium">
                      {city.city ?? t('cityOther')}
                    </h2>
                  ) : null}
                  <h3 lang={scriptLang(court.court)} className="text-ink-muted text-sm font-medium">
                    {court.court}
                  </h3>
                </div>
                {court.forums.map((forum) => {
                  const at = positionOf.get(forum.code) ?? 0;
                  return (
                    <div key={forum.id} role="gridcell">
                      <ForumCard
                        forum={forum}
                        slug={slug}
                        tabIndex={at === activeIndex ? 0 : -1}
                        linkRef={(node) => {
                          if (node === null) links.current.delete(forum.code);
                          else links.current.set(forum.code, node);
                        }}
                        onFocus={() => {
                          setActiveCode(forum.code);
                        }}
                        onKeyDown={onKeyDown(at, forum)}
                      />
                    </div>
                  );
                })}
              </div>
            )),
          )}
        </div>
      ) : null}
      {shown.disabled.length > 0 ? (
        <section aria-labelledby={plannedId} data-courts-planned="" className="flex flex-col gap-2">
          <h2 id={plannedId} className="font-serif text-xl font-medium">
            {t('planned.title')}
          </h2>
          <p className="text-ink-muted text-sm">{t('planned.hint')}</p>
          <ul className="flex flex-col gap-2">
            {shown.disabled.map((forum) => (
              <PlannedForum key={forum.id} forum={forum} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** A disabled forum: its name and reason, never a link. */
function PlannedForum({ forum }: { forum: DisabledForum }) {
  const t = useTranslations('courts.planned');
  const name = forumName(forum);
  return (
    <li
      data-planned-forum={forum.code}
      className="border-line flex flex-col gap-0.5 rounded-md border border-dashed p-3"
    >
      <span lang={scriptLang(name)} className="font-medium">
        {name}
      </span>
      <span className="text-ink-muted text-sm">{forum.reason ?? t('reasonFallback')}</span>
    </li>
  );
}

/** The index could not be loaded: `Try again` re-renders the page on the server. */
export function CourtsLoadError() {
  const t = useTranslations('courts.error');
  const router = useRouter();
  return (
    <ErrorState
      data-pattern-state="error"
      title={t('title')}
      onRetry={() => {
        router.refresh();
      }}
      labels={{ retry: t('retry') }}
    />
  );
}
