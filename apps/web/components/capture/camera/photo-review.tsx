'use client';
// The review step (#52): every page with Retake / Delete / Reorder, whether to also upload the
// untouched originals (off unless the person keeps "Original"), and the upload action.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { PageStrip, type PageStripProps } from './page-strip.tsx';

export interface PhotoReviewProps extends Omit<PageStripProps, 'compact'> {
  keepOriginal: boolean;
  onKeepOriginal: (keep: boolean) => void;
  offline: boolean;
  busy: boolean;
  onUpload: () => void;
  onBack: () => void;
  onDiscard: () => void;
}

export function PhotoReview({
  pages,
  keepOriginal,
  onKeepOriginal,
  offline,
  busy,
  onUpload,
  onBack,
  onDiscard,
  ...handlers
}: PhotoReviewProps) {
  const t = useTranslations('camera');
  const checkboxId = useId();
  return (
    <div data-slot="photo-review" className="flex flex-col gap-4 p-4">
      <h2 className="text-ink font-serif text-lg">{t('review.title')}</h2>
      <PageStrip pages={pages} {...handlers} />
      <label htmlFor={checkboxId} className="text-ink flex min-h-11 items-center gap-3 text-sm">
        <input
          id={checkboxId}
          type="checkbox"
          className="size-5"
          checked={keepOriginal}
          onChange={(event) => {
            onKeepOriginal(event.target.checked);
          }}
        />
        {t('crop.original')}
      </label>
      {offline ? <p className="text-ink-muted text-sm">{t('offline')}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={busy || pages.length === 0} onClick={onUpload}>
          {t('review.upload', { count: pages.length })}
        </Button>
        <Button variant="secondary" className="min-h-11" onClick={onBack}>
          {t('shutter')}
        </Button>
        <Button variant="ghost" className="min-h-11" onClick={onDiscard}>
          {t('review.discard')}
        </Button>
      </div>
    </div>
  );
}
