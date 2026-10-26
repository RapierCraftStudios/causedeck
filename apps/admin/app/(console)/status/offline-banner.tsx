'use client';
// Shown while the browser is offline. It disables nothing: a submit fails on its own and the
// action's error page says so; the notice only explains why.
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <p role="status" className="border-line rounded border p-2 text-sm">
      You are offline. Changes cannot be saved until the connection returns.
    </p>
  );
}
