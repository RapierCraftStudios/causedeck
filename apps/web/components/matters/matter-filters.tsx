'use client';
// The matters list's search, filters and sort (#388). The URL is the only state: every change
// replaces it through `matterListHref`, which drops the cursor (back to the first page). Search
// (`data-page-search`, so the shell's `/` focuses it) applies on Enter or 300 ms after typing stops.
// From 768 px the filters sit inline; on phones a sticky `Filter` button opens them in a bottom
// sheet, loaded on first open so Radix stays out of the route's JS.
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';

import type { FilterOption } from '../../lib/matters/graph-deps.ts';
import {
  hasMatterFilters,
  matterListHref,
  MATTER_LIST_SORTS,
  MATTER_LIST_STATUSES,
  type MatterListPatch,
  type MatterListState,
  type MatterSort,
  type MatterStatus,
} from '../../lib/matters/list-params.ts';

/** How long typing pauses before the search applies. */
export const SEARCH_DEBOUNCE_MS = 300;

const SELECT_CLASS =
  'border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm md:w-auto';

interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  done: string;
  children: ReactNode;
}

const FilterSheet = lazy(async () => {
  const { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } =
    await import('@causedeck/ui/sheet');
  function MatterFilterSheet({ open, onOpenChange, title, done, children }: FilterSheetProps) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" data-slot="matter-filters-sheet">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4">{children}</div>
          <SheetFooter>
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {done}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }
  return { default: MatterFilterSheet };
});

export interface MatterFiltersProps {
  state: MatterListState;
  slug: string;
  owners: readonly FilterOption[];
  forums: readonly FilterOption[];
}

export function MatterFilters({ state, slug, owners, forums }: MatterFiltersProps) {
  const t = useTranslations('matters');
  const router = useRouter();
  const [query, setQuery] = useState(state.q ?? '');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLoaded, setSheetLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The URL changed elsewhere (Back, Clear filters): show its query.
  useEffect(() => {
    setQuery(state.q ?? '');
  }, [state.q]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const apply = (patch: MatterListPatch) => {
    router.replace(matterListHref(slug, state, patch), { scroll: false });
  };

  const applySearch = (value: string) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const q = value.trim();
    if (q === (state.q ?? '')) return;
    apply({ q: q === '' ? undefined : q });
  };

  const fields = () => (
    <>
      <label className="flex flex-col gap-1 text-sm md:flex-row md:items-center md:gap-2">
        <span className="text-ink-muted">{t('filters.status')}</span>
        <select
          data-matter-filter="status"
          className={SELECT_CLASS}
          value={state.status ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            apply({ status: value === '' ? undefined : (value as MatterStatus) });
          }}
        >
          <option value="">{t('filters.statusAny')}</option>
          {MATTER_LIST_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`filters.statusValues.${status}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm md:flex-row md:items-center md:gap-2">
        <span className="text-ink-muted">{t('filters.forum')}</span>
        <select
          data-matter-filter="forum"
          className={SELECT_CLASS}
          value={state.forum ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            apply({ forum: value === '' ? undefined : value });
          }}
        >
          <option value="">{t('filters.forumAny')}</option>
          {forums.map((forum) => (
            <option key={forum.id} value={forum.id}>
              {forum.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm md:flex-row md:items-center md:gap-2">
        <span className="text-ink-muted">{t('filters.owner')}</span>
        <select
          data-matter-filter="owner"
          className={SELECT_CLASS}
          value={state.owner ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            apply({ owner: value === '' ? undefined : value });
          }}
        >
          <option value="">{t('filters.ownerAny')}</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
        <input
          type="checkbox"
          data-matter-filter="noNextDate"
          className="accent-accent size-4"
          checked={state.noNextDate === true}
          onChange={(event) => {
            apply({ noNextDate: event.target.checked ? true : undefined });
          }}
        />
        {t('filters.noNextDate')}
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
        <input
          type="checkbox"
          data-matter-filter="sensitive"
          className="accent-accent size-4"
          checked={state.sensitive === true}
          onChange={(event) => {
            apply({ sensitive: event.target.checked ? true : undefined });
          }}
        />
        {t('filters.sensitive')}
      </label>
      <label className="flex flex-col gap-1 text-sm md:flex-row md:items-center md:gap-2">
        <span className="text-ink-muted">{t('filters.sort')}</span>
        <select
          data-matter-filter="sort"
          className={SELECT_CLASS}
          value={state.sort}
          onChange={(event) => {
            apply({ sort: event.target.value as MatterSort });
          }}
        >
          {MATTER_LIST_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(`filters.sortValues.${sort}`)}
            </option>
          ))}
        </select>
      </label>
      {hasMatterFilters(state) ? (
        <Button
          type="button"
          variant="ghost"
          data-slot="clear-filters"
          onClick={() => {
            setQuery('');
            router.replace(matterListHref(slug, { sort: state.sort }), { scroll: false });
          }}
        >
          {t('filters.clear')}
        </Button>
      ) : null}
    </>
  );

  return (
    <section aria-label={t('filters.label')} className="flex flex-col gap-3">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          applySearch(query);
        }}
      >
        <Input
          type="search"
          data-page-search=""
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          className="max-w-md"
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            if (timer.current !== null) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              applySearch(value);
            }, SEARCH_DEBOUNCE_MS);
          }}
        />
      </form>
      <div data-matter-filters="inline" className="flex flex-wrap items-center gap-3 max-md:hidden">
        {fields()}
      </div>
      <div className="bg-surface/95 sticky top-14 z-10 py-1 md:hidden">
        <Button
          type="button"
          variant="secondary"
          data-slot="open-matter-filters"
          onClick={() => {
            setSheetLoaded(true);
            setSheetOpen(true);
          }}
        >
          <SlidersHorizontal aria-hidden="true" />
          {t('filters.open')}
        </Button>
      </div>
      {sheetLoaded ? (
        <Suspense fallback={null}>
          <FilterSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            title={t('filters.label')}
            done={t('filters.done')}
          >
            {fields()}
          </FilterSheet>
        </Suspense>
      ) : null}
    </section>
  );
}
