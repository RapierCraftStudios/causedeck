'use client';
// Settings offline state (#284, #25 design spec): while the browser is offline, settings are
// read-only and the banner says `Settings can be changed when you are back online.` Forms read
// `useOnline()` to disable their controls and the save button.
import { Alert } from '@causedeck/ui/alert';
import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** `navigator.onLine`, live; `true` on the server. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export function SettingsOfflineBanner() {
  const t = useTranslations('settings');
  const online = useOnline();
  if (online) return null;
  return (
    <Alert tone="warning" icon={<WifiOff />} data-pattern-state="offline">
      {t('offline')}
    </Alert>
  );
}
