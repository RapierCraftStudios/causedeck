'use client';
// Processing (#48): captures in `received|scanning|queued|processing`, plus the ones saved on this
// device and not uploaded yet. With nothing in flight the section is not drawn at all.
import type { Locale } from '@causedeck/i18n';
import { useTranslations } from 'next-intl';

import type { ProcessingItemView } from '../../lib/inbox/view.ts';

import { CaptureRow } from './capture-row.tsx';

export function ProcessingList({ rows, locale }: { rows: ProcessingItemView[]; locale: Locale }) {
  const t = useTranslations('inbox');
  if (rows.length === 0) return null;
  return (
    <section aria-label={t('sections.processing')} data-slot="processing-list">
      <ul className="grid gap-3">
        {rows.map((row) => (
          <CaptureRow key={row.captureId} row={row} locale={locale} />
        ))}
      </ul>
    </section>
  );
}
