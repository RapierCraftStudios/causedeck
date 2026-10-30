'use client';

// The help page body (#94): list and article side by side; selecting an article changes the URL.
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { HelpArticles } from './help-articles.tsx';

export function HelpPage({ slug, article }: { slug: string; article: string | undefined }) {
  const t = useTranslations('help');
  const router = useRouter();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <HelpArticles
        columns
        selected={article}
        onSelect={(next) => {
          router.push(next === undefined ? `/w/${slug}/help` : `/w/${slug}/help/${next}`);
        }}
      />
    </div>
  );
}
