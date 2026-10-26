'use client';

import { NotFound } from '@causedeck/ui/patterns/states';
import { useTranslations } from 'next-intl';

// A client component: the patterns entry point includes interactive (hook-using) patterns.
/** A workspace route that does not exist, or a feature that is switched off. */
export default function WorkspaceNotFound() {
  const t = useTranslations('shell.notFound');
  return (
    <div className="flex flex-col items-center gap-4">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <NotFound className="w-full max-w-md" message={t('message')} />
    </div>
  );
}
