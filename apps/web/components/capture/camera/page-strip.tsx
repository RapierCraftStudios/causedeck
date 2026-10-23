'use client';
// The pages of the batch (#52): thumbnails with move earlier/later, retake and delete, each a real
// button of at least 44 px with the page number in its accessible name.
import { Button } from '@causedeck/ui/button';
import { ArrowLeft, ArrowRight, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface StripPage {
  /** Stable id of the page within the session. */
  id: number;
  /** An object URL of the processed JPEG. */
  url: string;
}

export interface PageStripProps {
  pages: readonly StripPage[];
  /** Compact: thumbnails only (beside the shutter). */
  compact?: boolean;
  onMove?: (from: number, to: number) => void;
  onRetake?: (position: number) => void;
  onDelete?: (position: number) => void;
}

export function PageStrip({ pages, compact = false, onMove, onRetake, onDelete }: PageStripProps) {
  const t = useTranslations('camera.strip');
  if (pages.length === 0) {
    return compact ? null : <p className="text-sm">{t('empty')}</p>;
  }
  return (
    <ol
      aria-label={t('label')}
      data-slot="page-strip"
      className={compact ? 'flex gap-1 overflow-x-auto' : 'grid grid-cols-2 gap-3 sm:grid-cols-3'}
    >
      {pages.map((page, position) => {
        const n = position + 1;
        return (
          <li key={page.id} className="flex flex-col gap-1">
            <img
              src={page.url}
              alt={t('page', { n })}
              className={
                compact
                  ? 'size-11 rounded object-cover'
                  : 'aspect-[3/4] w-full rounded-md object-cover'
              }
            />
            {compact ? null : (
              <div className="flex flex-wrap gap-1">
                <Button
                  size="lg"
                  variant="ghost"
                  className="w-11 px-0"
                  aria-label={t('earlier', { n })}
                  disabled={position === 0}
                  onClick={() => onMove?.(position, position - 1)}
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="w-11 px-0"
                  aria-label={t('later', { n })}
                  disabled={position === pages.length - 1}
                  onClick={() => onMove?.(position, position + 1)}
                >
                  <ArrowRight aria-hidden="true" />
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="w-11 px-0"
                  aria-label={t('retake', { n })}
                  onClick={() => onRetake?.(position)}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="w-11 px-0"
                  aria-label={t('delete', { n })}
                  onClick={() => onDelete?.(position)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
