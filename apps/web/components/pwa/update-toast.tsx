'use client';

// The update toast (#50). The service worker registers here; a new version installs in the
// background and waits. It never forces a reload during court-day windows (07:00-10:30 and
// 18:00-23:00 IST): the toast then only informs. Outside them the update applies on the next
// navigation (the page being hidden or left) and the toast offers "Update now".
import { Alert, AlertTitle } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { applyWaitingUpdate, registerServiceWorker } from '../../lib/pwa/install.ts';
import { updateDecision } from '../../lib/pwa/update-policy.ts';

export interface UpdateToastViewProps {
  /** Show the "Update now" action (never inside a court-day window). */
  offerUpdateNow: boolean;
  onUpdateNow: () => void;
}

export function UpdateToastView({ offerUpdateNow, onUpdateNow }: UpdateToastViewProps) {
  const t = useTranslations('pwa.update');
  return (
    <Alert
      tone="info"
      role="status"
      data-update-toast=""
      action={
        offerUpdateNow ? (
          <Button size="lg" variant="outline" onClick={onUpdateNow}>
            {t('now')}
          </Button>
        ) : undefined
      }
    >
      <AlertTitle>{t('ready')}</AlertTitle>
    </Alert>
  );
}

export function UpdateToast() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const reloadOnChange = useRef(false);

  useEffect(() => {
    let alive = true;
    void registerServiceWorker((waiting) => {
      if (alive) setRegistration(waiting);
    });
    const onControllerChange = () => {
      // Only a reload the person asked for; a silent takeover never reloads the page.
      if (reloadOnChange.current) window.location.reload();
    };
    navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange);
    return () => {
      alive = false;
      navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  // Next navigation: leaving or hiding the page lets the waiting worker take over (not in a window).
  useEffect(() => {
    if (registration === null) return undefined;
    const apply = () => {
      if (updateDecision(new Date()).applyOnNavigation) applyWaitingUpdate(registration);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') apply();
    };
    window.addEventListener('pagehide', apply);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', apply);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [registration]);

  if (registration === null) return null;
  return (
    <UpdateToastView
      offerUpdateNow={updateDecision(new Date()).offerUpdateNow}
      onUpdateNow={() => {
        reloadOnChange.current = true;
        applyWaitingUpdate(registration);
      }}
    />
  );
}
