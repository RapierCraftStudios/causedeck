'use client';
// Offline on the matters list (#388): the banner says the list is the last saved one and that
// changes will not save; `useOnline()` lets `New matter` and the `n` key switch off meanwhile.
import { OfflineBanner } from '@causedeck/ui/patterns';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/** When the browser went offline, or null while online. */
export function useOfflineSince(): Date | null {
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);

  useEffect(() => {
    const sync = () => {
      setOfflineSince((since) => (navigator.onLine ? null : (since ?? new Date())));
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return offlineSince;
}

/** False while the browser is offline (true on the server and before mount). */
export function useOnline(): boolean {
  return useOfflineSince() === null;
}

export function MattersOfflineBanner({ forced = false }: { forced?: boolean }) {
  const t = useTranslations('matters');
  const locale = useLocale();
  const offlineSince = useOfflineSince();
  const since = offlineSince ?? (forced ? new Date(0) : null);
  if (since === null) return null;
  return (
    <OfflineBanner
      data-matters-offline=""
      savedAt={since}
      locale={`${locale}-IN`}
      labels={{ message: () => t('offline') }}
    />
  );
}
