'use client';

import { OfflineBanner } from '@causedeck/ui/patterns';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/** The offline banner of the courts area: "Showing saved court information", only while offline. */
export function CourtsOfflineBanner() {
  const t = useTranslations('courts');
  const locale = useLocale();
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

  if (offlineSince === null) return null;
  return (
    <OfflineBanner
      data-courts-offline=""
      savedAt={offlineSince}
      locale={`${locale}-IN`}
      labels={{ message: (time) => t('offline', { time }) }}
    />
  );
}
