import { EmptyState } from '@causedeck/ui/empty-state';
import { WifiOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = { title: 'Offline' };

/** Offline fallback. The service worker that serves it arrives in the Offline milestone. */
export default async function OfflinePage() {
  const [t, common] = await Promise.all([getTranslations('offline'), getTranslations('common')]);
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col items-center justify-center px-4 md:px-6 xl:px-8"
    >
      <h1 className="sr-only">{t('title')}</h1>
      <EmptyState
        data-pattern-state="offline"
        icon={<WifiOff />}
        title={t('body')}
        action={
          <Link
            href="/"
            className="text-ink focus-visible:outline-ring rounded-sm text-sm font-medium underline underline-offset-4 outline-offset-2 focus-visible:outline-2"
          >
            {common('goToToday')}
          </Link>
        }
      />
    </main>
  );
}
