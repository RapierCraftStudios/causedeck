'use client';

import { Skeleton } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

import { OutwardStates } from '../../../../../components/outward/draft-list.tsx';

/** Drafts loading (#736): the header and cards with the final cards' geometry. */
export default function DraftsLoading() {
  const t = useTranslations('outward');
  return (
    <div data-slot="drafts-skeleton" className="grid gap-4">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <Skeleton className="h-6 w-2/3" />
      <OutwardStates state="loading" />
    </div>
  );
}
