'use client';

import { NotFound } from '@causedeck/ui/patterns';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

// A client component: the patterns entry point includes interactive (hook-using) patterns.
export default function NotFoundPage() {
  const t = useTranslations('notFound');
  const common = useTranslations('common');
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col items-center justify-center gap-4 px-4 md:px-6 xl:px-8"
    >
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <NotFound className="w-full max-w-md" />
      <Link
        href="/"
        className="text-ink focus-visible:outline-ring rounded-sm text-sm font-medium underline underline-offset-4 outline-offset-2 focus-visible:outline-2"
      >
        {common('goToToday')}
      </Link>
    </main>
  );
}
