'use client';
// Offline banner and the polite live region of the board (#59). The banner reads the connection from
// the `useCourtDayData` seam; the live region announces list changes as they arrive.
import { useTranslations } from 'next-intl';

import { useCourtDayData } from './use-court-day-data.ts';

export function BoardStatus({ changes, readAt }: { changes: number; readAt: Date | null }) {
  const t = useTranslations('courtDay.board');
  const { offline } = useCourtDayData(null, readAt);
  return (
    <>
      {offline ? (
        <div
          role="status"
          data-offline-banner
          className="border-warning/50 bg-warning-soft rounded-md border px-3 py-2 text-sm"
        >
          {t('offline')}
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite" data-diff-live>
        {changes === 0 ? '' : t('diff.banner', { count: changes })}
      </p>
    </>
  );
}
