'use client';
// Offline banner and the polite live region of the board (#59). The banner reads the connection from
// the `useCourtDayData` seam; the live region announces list changes as they arrive.
import { useLocale, useTranslations } from 'next-intl';

import { useCourtDayData } from './use-court-day-data.ts';

export function BoardStatusView({ changes, readAt }: { changes: number; readAt: Date | null }) {
  const t = useTranslations('courtDay.board');
  const locale = useLocale();
  const { offline, readAt: shownAt } = useCourtDayData(null, readAt);
  const time =
    shownAt === null
      ? null
      : new Intl.DateTimeFormat(locale, {
          timeZone: 'Asia/Kolkata',
          hour: 'numeric',
          minute: '2-digit',
        }).format(shownAt);
  return (
    <>
      {offline ? (
        <div
          role="status"
          data-offline-banner
          className="border-warning/50 bg-warning-soft rounded-md border px-3 py-2 text-sm"
        >
          {time === null ? t('offline') : t('offlineAt', { time })}
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite" data-diff-live>
        {changes === 0 ? '' : t('diff.banner', { count: changes })}
      </p>
    </>
  );
}
