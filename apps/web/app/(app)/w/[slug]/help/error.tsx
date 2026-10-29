'use client';

import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportError } from '../../../../../lib/report-error.ts';

export default function HelpError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('help');
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <p>{t('search.error')}</p>
      <Button onClick={reset}>{t('search.retry')}</Button>
    </div>
  );
}
