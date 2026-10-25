'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { SheetMasthead } from './model.ts';

/** The matter masthead: title, case number and the listing date, set above the sections. */
export function Masthead({ masthead, assembledAt }: { masthead: SheetMasthead; assembledAt: string }) {
  const t = useTranslations('brief.masthead');
  const time = new Date(assembledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <header className="border-border mb-6 grid gap-1 border-b pb-4 print:mb-3 print:border-black">
      <h1 className="font-serif text-2xl leading-tight font-medium print:text-[15pt]">{masthead.matterTitle}</h1>
      <p className="text-muted-foreground font-sans text-sm print:text-black">
        {[masthead.caseNo, masthead.listDate ? t('listedOn', { date: masthead.listDate }) : null, t('assembled', { time })]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <Link href={masthead.matterHref} className="w-fit font-sans text-sm underline print:hidden">
        {t('openMatter')}
      </Link>
    </header>
  );
}
