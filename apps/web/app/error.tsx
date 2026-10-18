'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { reportError } from '../lib/report-error.ts';

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Route error boundary. Shows only translated copy and the digest, never the message or stack. */
export default function RouteError({ error, reset }: RouteErrorProps) {
  const t = useTranslations('error');
  const common = useTranslations('common');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col items-center justify-center gap-4 px-4 md:px-6 xl:px-8"
    >
      <h1 ref={heading} tabIndex={-1} className="font-serif text-2xl font-medium outline-none">
        {t('title')}
      </h1>
      <ErrorState
        className="w-full max-w-md"
        title={t('description')}
        description={error.digest ? t('reference', { digest: error.digest }) : undefined}
        onRetry={reset}
      />
      <Link
        href="/"
        className="text-ink focus-visible:outline-ring rounded-sm text-sm font-medium underline underline-offset-4 outline-offset-2 focus-visible:outline-2"
      >
        {common('goToToday')}
      </Link>
    </main>
  );
}
