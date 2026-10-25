'use client';

// Help search and article view (#94), shared by the help page and the help sheet. The bundled
// index is built in the browser (loading skeleton first, an error with retry if it cannot be
// built), so search works offline and no query is sent anywhere. An offline note shows when the
// device has no connection; articles stay readable.
import { Input } from '@causedeck/ui/input';
import { Button } from '@causedeck/ui/button';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState, useSyncExternalStore } from 'react';

import {
  getArticle,
  helpIndex,
  searchHelp,
  type HelpIndex,
  type HelpSurface,
} from '../../lib/help/index.ts';

import { HelpMarkdown } from './markdown.tsx';

const subscribeOnline = (notify: () => void) => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};

/** True while the device reports no connection. */
export function useOffline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => !navigator.onLine,
    () => false,
  );
}

export interface HelpArticlesProps {
  /** The open article; `undefined` shows the list. */
  selected: string | undefined;
  onSelect: (slug: string | undefined) => void;
  /** Starts the list narrowed to a surface (a contextual tip). */
  surface?: HelpSurface | undefined;
  /** Side-by-side list and article (the page) instead of one at a time (the sheet). */
  columns?: boolean | undefined;
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; index: HelpIndex };

export function HelpArticles({ selected, onSelect, columns = false }: HelpArticlesProps) {
  const t = useTranslations('help');
  const format = useFormatter();
  const offline = useOffline();
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | undefined>(undefined);

  // The bundled index loads after hydration so the first paint is the skeleton; `attempt` re-runs it.
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const load = useMemo<Load>(() => {
    if (!hydrated) return { status: 'loading' };
    try {
      return { status: 'ready', index: helpIndex() };
    } catch {
      return { status: 'error' };
    }
  }, [hydrated, attempt]);

  const results = useMemo(
    () => (load.status === 'ready' ? searchHelp(load.index, query, { tag }) : []),
    [load, query, tag],
  );

  if (load.status === 'loading') {
    return (
      <SkeletonGroup labels={{ loading: t('search.loading') }}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-3 h-16 w-full" />
        <Skeleton className="mt-3 h-16 w-full" />
      </SkeletonGroup>
    );
  }
  if (load.status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p>{t('search.error')}</p>
        <Button
          onClick={() => {
            setAttempt((n) => n + 1);
          }}
        >
          {t('search.retry')}
        </Button>
      </div>
    );
  }

  const article = selected === undefined ? undefined : getArticle(selected);
  const showList = columns || selected === undefined;
  const showArticle = columns || selected !== undefined;

  return (
    <div className="flex flex-col gap-3">
      {offline ? (
        <p role="status" className="bg-surface-sunken rounded-md p-2 text-sm">
          {t('offline')}
        </p>
      ) : null}
      <div className={columns ? 'grid gap-6 md:grid-cols-[18rem_1fr]' : 'flex flex-col gap-3'}>
        {showList ? (
          <div className="flex flex-col gap-3">
            <Input
              type="search"
              aria-label={t('search.label')}
              placeholder={t('search.placeholder')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            <div role="group" aria-label={t('search.tags')} className="flex flex-wrap gap-1">
              {[undefined, ...load.index.tags].map((value) => (
                <Button
                  key={value ?? 'all'}
                  size="sm"
                  variant={tag === value ? 'primary' : 'ghost'}
                  aria-pressed={tag === value}
                  onClick={() => {
                    setTag(value);
                  }}
                >
                  {value ?? t('search.allTags')}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs" aria-live="polite">
              {t('search.results', { count: results.length })}
            </p>
            {results.length === 0 ? (
              <p>{t('search.empty', { query })}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {results.map((result) => (
                  <li key={result.slug}>
                    <button
                      type="button"
                      aria-current={result.slug === selected ? 'page' : undefined}
                      className="hover:bg-surface-sunken w-full rounded-md p-2 text-start text-sm font-medium"
                      onClick={() => {
                        onSelect(result.slug);
                      }}
                    >
                      {result.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {showArticle ? (
          <article className="flex flex-col gap-3">
            {selected === undefined ? null : article ? (
              <>
                {columns ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      onSelect(undefined);
                    }}
                  >
                    {t('article.back')}
                  </Button>
                )}
                <h2 className="font-sans text-lg font-semibold">{article.title}</h2>
                <p className="text-muted-foreground text-xs">
                  {t('article.updated', {
                    date: format.dateTime(new Date(article.updated), { dateStyle: 'medium' }),
                  })}
                </p>
                <HelpMarkdown
                  source={article.body}
                  onNavigate={onSelect}
                  isArticle={(slug) => getArticle(slug) !== undefined}
                />
              </>
            ) : (
              <p role="alert">{t('article.notFound')}</p>
            )}
          </article>
        ) : null}
      </div>
    </div>
  );
}
