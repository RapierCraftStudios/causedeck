/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
'use client';

import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { reportError } from '../../../../../../../lib/report-error.ts';

interface OutcomeErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** The outcome could not load: a retry, never the raw message. */
export default function OutcomeError({ error, reset }: OutcomeErrorProps) {
  const t = useTranslations('outcome.error');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
    heading.current?.focus();
  }, [error]);
  return (
    <div role="alert" className="grid gap-3">
      <h1 ref={heading} tabIndex={-1} className="font-serif text-2xl font-medium outline-none">
        {t('title')}
      </h1>
      <Button type="button" onClick={reset} className="w-fit">
        {t('retry')}
      </Button>
    </div>
  );
}
