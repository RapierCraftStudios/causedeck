'use client';

// The push permission card (#197, #23 design). The browser permission prompt only ever follows a
// click on `Turn on`, never page load. The card is hidden when push is disabled on the server (no
// VAPID key), when the browser cannot do Web Push (e.g. iOS Safari outside an installed PWA), when
// this browser is already subscribed or blocked, and after `Not now`. `Turn on` registers the
// standalone push service worker, subscribes with the VAPID public key and stores the subscription
// through `POST /api/push/subscribe`. Its home is the notification panel footer (#198).
import { Button } from '@causedeck/ui/button';
import { BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

export const PUSH_SW_URL = '/push-sw-handler.js';
export const PUSH_CARD_DISMISSED_KEY = 'causedeck.pushCard.dismissed';

type Status = 'hidden' | 'idle' | 'working' | 'enabled' | 'blocked' | 'error';

/** Web Push needs a service worker, `PushManager` and the Notifications API. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** A URL-safe base64 VAPID public key as the bytes `pushManager.subscribe` expects. */
export function vapidKeyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function dismissed(): boolean {
  try {
    return window.localStorage.getItem(PUSH_CARD_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function subscribe(vapidPublicKey: string): Promise<void> {
  await navigator.serviceWorker.register(PUSH_SW_URL, { scope: '/' });
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(vapidPublicKey),
    }));
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) throw new Error(`subscribe failed (${String(response.status)})`);
}

export interface PushPermissionCardProps {
  /** The server's VAPID public key; `null` when push is disabled. */
  vapidPublicKey: string | null;
}

export function PushPermissionCard({ vapidPublicKey }: PushPermissionCardProps) {
  const t = useTranslations('notifications.push.card');
  const titleId = useId();
  const [status, setStatus] = useState<Status>('hidden');

  useEffect(() => {
    if (vapidPublicKey === null || !isPushSupported() || dismissed()) return;
    if (Notification.permission === 'denied') return;
    let active = true;
    existingSubscription()
      .then((existing) => {
        if (active && (existing === null || Notification.permission !== 'granted')) {
          setStatus('idle');
        }
      })
      .catch(() => {
        if (active) setStatus('idle');
      });
    return () => {
      active = false;
    };
  }, [vapidPublicKey]);

  if (status === 'hidden' || vapidPublicKey === null) return null;

  const turnOn = async () => {
    setStatus('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'idle');
        return;
      }
      await subscribe(vapidPublicKey);
      setStatus('enabled');
    } catch {
      setStatus('error');
    }
  };

  const notNow = () => {
    try {
      window.localStorage.setItem(PUSH_CARD_DISMISSED_KEY, '1');
    } catch {
      // Storage unavailable (private mode): hide for this page view only.
    }
    setStatus('hidden');
  };

  const done = status === 'enabled' || status === 'blocked';
  return (
    <section
      aria-labelledby={titleId}
      data-push-card={status}
      className="border-line bg-surface flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex items-start gap-3">
        <BellRing aria-hidden className="text-accent mt-0.5 size-5 shrink-0" />
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-sm font-medium">
            {t('title')}
          </h2>
          <p className="text-ink-muted text-sm">{t('body')}</p>
        </div>
      </div>
      <p role="status" className="text-ink-muted text-sm empty:hidden">
        {status === 'enabled' ? t('enabled') : null}
        {status === 'blocked' ? t('blocked') : null}
        {status === 'error' ? t('error') : null}
      </p>
      {done ? null : (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={notNow} disabled={status === 'working'}>
            {t('notNow')}
          </Button>
          <Button
            size="sm"
            onClick={() => void turnOn()}
            loading={status === 'working'}
            disabled={status === 'working'}
          >
            {t('turnOn')}
          </Button>
        </div>
      )}
    </section>
  );
}
