'use client';
// Offline on the drafts list (#826): the banner says the list is the last saved one and that new
// drafts cannot be created. `useOnline` (shared with the matters list) switches `New draft` off.
import { OfflineBanner } from '@causedeck/ui/patterns';
import { useLocale, useTranslations } from 'next-intl';

import { useOfflineSince } from '../matters/matters-offline-banner.tsx';

export function DraftsOfflineBanner({ forced = false }: { forced?: boolean }) {
  const t = useTranslations('drafting.offline');
  const locale = useLocale();
  const offlineSince = useOfflineSince();
  const since = offlineSince ?? (forced ? new Date(0) : null);
  if (since === null) return null;
  return (
    <OfflineBanner
      data-drafts-offline=""
      savedAt={since}
      locale={`${locale}-IN`}
      labels={{ message: () => t('listBanner') }}
    />
  );
}
