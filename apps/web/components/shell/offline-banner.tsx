'use client';

import { OfflineBanner } from '@causedeck/ui/patterns/states';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/** The #145 offline banner, shown at the top of content only while `navigator.onLine` is false. */
export function ShellOfflineBanner() {
  const t = useTranslations('shell.offline');
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
      savedAt={offlineSince}
      locale={`${locale}-IN`}
      labels={{ message: (time) => t('message', { time }) }}
    />
  );
}
