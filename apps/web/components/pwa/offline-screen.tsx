'use client';

// The `/offline` screen (#50): what still works without a connection, what does not, how much is
// waiting to upload, and a way back. Keyboard accessible; semantic tokens only, so it passes axe in
// both themes. The outbox summary appears once the device's outbox has loaded.
import { Check, WifiOff, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { summarize } from '../../lib/pwa/outbox/queue.ts';

import { useOutbox } from './outbox-indicator.tsx';

export interface OfflineScreenViewProps {
  waiting: number;
}

export function OfflineScreenView({ waiting }: OfflineScreenViewProps) {
  const t = useTranslations('pwa.offline');
  const common = useTranslations('common');
  return (
    <main
      id="main"
      tabIndex={-1}
      data-pattern-state="offline"
      className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center gap-6 px-4 py-10 md:px-6"
    >
      <div className="flex items-center gap-3">
        <WifiOff aria-hidden="true" className="text-info size-6" />
        <h1 className="text-ink text-xl font-semibold">{t('title')}</h1>
      </div>
      <p className="text-ink-muted text-sm">{t('intro')}</p>
      <section aria-labelledby="offline-works" className="flex flex-col gap-2">
        <h2 id="offline-works" className="text-ink text-sm font-semibold">
          {t('works.title')}
        </h2>
        <ul className="text-ink flex flex-col gap-2 text-sm">
          <li className="flex gap-2">
            <Check aria-hidden="true" className="text-success mt-0.5 size-4 shrink-0" />
            {t('works.saved')}
          </li>
          <li className="flex gap-2">
            <Check aria-hidden="true" className="text-success mt-0.5 size-4 shrink-0" />
            {t('works.capture')}
          </li>
        </ul>
      </section>
      <section aria-labelledby="offline-needs" className="flex flex-col gap-2">
        <h2 id="offline-needs" className="text-ink text-sm font-semibold">
          {t('doesNot.title')}
        </h2>
        <p className="text-ink flex gap-2 text-sm">
          <X aria-hidden="true" className="text-ink-muted mt-0.5 size-4 shrink-0" />
          {t('doesNot.items')}
        </p>
      </section>
      <p role="status" className="text-ink text-sm" data-offline-outbox="">
        {waiting === 0 ? t('outbox.none') : t('outbox.some', { count: waiting })}
      </p>
      <Link
        href="/"
        className="text-ink focus-visible:outline-ring flex min-h-11 w-fit items-center rounded-sm text-sm font-medium underline underline-offset-4 outline-offset-2 focus-visible:outline-2"
      >
        {common('goToToday')}
      </Link>
    </main>
  );
}

export function OfflineScreen() {
  const summary = summarize(useOutbox());
  return <OfflineScreenView waiting={summary.total} />;
}
