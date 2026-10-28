'use client';
// The matter's status links (#88): state, expiry, "Viewed N times" and Revoke. States: loading,
// empty, error with retry.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';

import type { StatusLinkListItem } from './actions.ts';

export type LinkListState =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; items: StatusLinkListItem[] };

export interface StatusLinkListProps {
  list: LinkListState;
  canRevoke: boolean;
  onRevoke: (id: string) => void;
  onRetry: () => void;
}

export function StatusLinkList({ list, canRevoke, onRevoke, onRetry }: StatusLinkListProps) {
  const t = useTranslations('statusLink.list');
  const date = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(
      new Date(iso),
    );
  return (
    <section aria-label={t('title')} className="space-y-2">
      <h3 className="font-medium">{t('title')}</h3>
      {list.state === 'loading' ? (
        <div
          aria-busy="true"
          aria-label={t('loading')}
          className="bg-muted h-10 animate-pulse rounded"
        />
      ) : list.state === 'error' ? (
        <div role="alert" className="space-y-2">
          <p>{t('error')}</p>
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            {t('retry')}
          </Button>
        </div>
      ) : list.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <ul className="divide-y">
          {list.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="font-medium">{item.headline}</p>
                <p className="text-muted-foreground text-sm">
                  {t(item.state)} · {t('expires', { date: date(item.expiresAt) })} ·{' '}
                  {t('viewed', { count: item.views })}
                </p>
              </div>
              {canRevoke && item.state === 'active' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onRevoke(item.id);
                  }}
                >
                  {t('revoke')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
