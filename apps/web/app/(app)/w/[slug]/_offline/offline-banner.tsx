'use client';
// Offline banner (#65 part 5): a polite live region that is always mounted, so assistive tech
// announces the text when it appears. Warning tone (never red): being offline is a state, not an
// error. It says what is on screen was saved on this device and when; past the staleness limit
// it adds that it may be out of date.
import { WifiOff } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';

import { isStale } from '../../../../../lib/offline/freshness.ts';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** `navigator.onLine`, live; `true` on the server. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export interface OfflineBannerProps {
  /** When the data on screen was saved on this device; null when unknown. */
  savedAt: Date | null;
  /** Overrides `navigator.onLine` (stories, tests). */
  online?: boolean;
  /** Clock for the staleness check (tests). */
  now?: number;
}

export function OfflineBanner({ savedAt, online, now }: OfflineBannerProps) {
  const t = useTranslations('offline.banner');
  const format = useFormatter();
  const live = useOnlineStatus();
  const [clock] = useState(() => Date.now());
  const isOnline = online ?? live;
  const time =
    savedAt === null
      ? null
      : format.dateTime(savedAt, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Kolkata',
        });
  const stale = savedAt !== null && isStale(savedAt.getTime(), now ?? clock);
  return (
    <div role="status" aria-live="polite" data-slot="offline-banner-region">
      {isOnline ? null : (
        <div
          data-slot="offline-banner"
          data-tone="warning"
          className="border-warning bg-warning-soft text-ink flex items-start gap-2 rounded-lg border px-3 py-2 font-sans text-sm"
        >
          <WifiOff aria-hidden="true" className="text-warning mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 wrap-break-word">
            {t('offline')}
            {time === null ? null : <> {stale ? t('stale', { time }) : t('savedAt', { time })}</>}
          </p>
        </div>
      )}
    </div>
  );
}
