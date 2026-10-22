'use client';
// A matter that does not exist, belongs to another workspace or is restricted from the member
// (#390): one message for all three, so the page never says whether the matter exists, and one
// way back to the list.
import { buttonVariants } from '@causedeck/ui/button';
import { NotFound } from '@causedeck/ui/patterns';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { mattersHref } from '../../../../../../lib/matters/list-params.ts';

export default function MatterNotFound() {
  const t = useTranslations('matters.workspace.notFound');
  const params = useParams<{ slug?: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  return (
    <div data-route="matter" data-matter-not-found="" className="flex flex-col items-center gap-4">
      <NotFound className="w-full max-w-md" message={t('title')} />
      <Link href={mattersHref(slug)} className={buttonVariants({ variant: 'primary' })}>
        {t('back')}
      </Link>
    </div>
  );
}
