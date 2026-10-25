// The courts area header (#399): title and the honest one-line description. Forum pages (#400)
// pass a breadcrumb back to the index through `back`.
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export interface CourtNavProps {
  /** A link back to the index, rendered above the title on forum pages. */
  back?: ReactNode;
  /** Replaces the area title (a forum's name on its own page). */
  title?: ReactNode;
}

export function CourtNav({ back, title }: CourtNavProps) {
  const t = useTranslations('courts');
  return (
    <header data-slot="court-nav" className="flex flex-col gap-1">
      {back === undefined ? null : <nav aria-label={t('title')}>{back}</nav>}
      <h1 className="font-serif text-2xl font-medium">{title ?? t('title')}</h1>
      <p className="text-ink-muted text-sm">{t('description')}</p>
    </header>
  );
}
