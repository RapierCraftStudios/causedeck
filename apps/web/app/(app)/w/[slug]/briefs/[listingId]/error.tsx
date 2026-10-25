/* eslint-disable unicorn/filename-case -- the route segment `[listingId]` is fixed by the issue's path */
'use client';

import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { reportError } from '../../../../../../lib/report-error.ts';

interface BriefErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** The brief could not load: Retry and Open matter, never the raw message. */
export default function BriefError({ error, reset }: BriefErrorProps) {
  const t = useTranslations('brief.error');
  const { slug } = useParams<{ slug: string }>();
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
      <div className="flex gap-2">
        <Button type="button" onClick={reset}>
          {t('retry')}
        </Button>
        <Button asChild variant="secondary">
          <Link href={`/w/${slug}/matters`}>{t('openMatter')}</Link>
        </Button>
      </div>
    </div>
  );
}
