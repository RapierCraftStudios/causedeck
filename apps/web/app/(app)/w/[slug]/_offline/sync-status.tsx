'use client';
// Sync status (#65 part 5): what the outbox is doing, in words. Syncing shows a spinner that stops
// under reduced motion; failed offers `Try again` and `Keep local` inline on every width, and a
// details popover on desktop. Coming back online shows a `Back online` toast once. State arrives
// through props: the drain that produces it is #745.
import { Button } from '@causedeck/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@causedeck/ui/popover';
import { toast } from '@causedeck/ui/sonner';
import { CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { useOnlineStatus } from './offline-banner.tsx';

export type SyncState = 'idle' | 'syncing' | 'failed';

export interface SyncStatusProps {
  state: SyncState;
  /** Changes waiting to sync. */
  pending?: number;
  lastSyncedAt?: Date | null;
  onRetry?: () => void;
  onKeepLocal?: () => void;
  /** Overrides `navigator.onLine` (stories, tests). */
  online?: boolean;
}

export function SyncStatus({
  state,
  pending = 0,
  lastSyncedAt = null,
  onRetry,
  onKeepLocal,
  online,
}: SyncStatusProps) {
  const t = useTranslations('offline');
  const format = useFormatter();
  const live = useOnlineStatus();
  const isOnline = online ?? live;
  const wasOnline = useRef(isOnline);

  useEffect(() => {
    if (isOnline && !wasOnline.current) toast(t('banner.backOnline'));
    wasOnline.current = isOnline;
  }, [isOnline, t]);

  const label =
    state === 'failed'
      ? t('sync.failed')
      : state === 'syncing'
        ? t('sync.syncing')
        : pending > 0
          ? t('sync.pending', { count: pending })
          : t('sync.idle');
  const Icon = state === 'failed' ? CircleAlert : state === 'syncing' ? LoaderCircle : CircleCheck;
  const lastSynced =
    lastSyncedAt === null
      ? null
      : t('sync.lastSynced', {
          time: format.dateTime(lastSyncedAt, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Asia/Kolkata',
          }),
        });

  return (
    <div
      data-slot="sync-status"
      data-state={state}
      className="flex flex-wrap items-center gap-2 font-sans text-sm"
    >
      <p role="status" aria-live="polite" className="flex items-center gap-2">
        <Icon
          aria-hidden="true"
          className={
            state === 'syncing'
              ? 'text-ink-muted size-4 animate-spin motion-reduce:animate-none'
              : state === 'failed'
                ? 'text-warning size-4'
                : 'text-ink-muted size-4'
          }
        />
        <span>{label}</span>
      </p>
      {state === 'failed' ? (
        <>
          <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
            {t('sync.retry')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onKeepLocal}>
            {t('sync.keepLocal')}
          </Button>
        </>
      ) : null}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t('sync.details')}
            className="hidden md:inline-flex"
          >
            <Info aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex flex-col gap-2 text-sm">
          <p className="font-medium">{t('sync.label')}</p>
          <p>{label}</p>
          {state === 'failed' ? <p className="text-ink-muted">{t('sync.detailsFailed')}</p> : null}
          {lastSynced === null ? null : <p className="text-ink-muted">{lastSynced}</p>}
        </PopoverContent>
      </Popover>
    </div>
  );
}
