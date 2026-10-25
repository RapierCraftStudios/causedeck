// The attention strip (#59): adapter-failure banners (UJ-9) and the list-change banner. Failed halls
// keep their last known data on screen, labelled as such, with the official list one click away
// (new window, never framed) and the share-again prompt.
import type { ListDiff } from '@causedeck/validators';
import { getTranslations } from 'next-intl/server';

import type { HallFailure } from './load-court-day.ts';
import { ListDiffSheet } from './list-diff-sheet.tsx';

export async function AttentionStrip({
  which,
  failures,
  diffs,
  locale,
}: {
  which: 'today' | 'tomorrow';
  failures: readonly (HallFailure & { hallNo: string })[];
  diffs: readonly ListDiff[];
  locale: string;
}) {
  const t = await getTranslations('courtDay.board');
  const changes = diffs.reduce((n, d) => n + d.added.length + d.removed.length + d.moved.length, 0);
  if (failures.length === 0 && changes === 0) return null;
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <div data-attention-strip className="flex flex-col gap-2">
      {failures.map((failure) => (
        <div
          key={failure.hallId}
          role="alert"
          data-adapter-failure
          className="border-warning/50 bg-warning-soft flex flex-col gap-1 rounded-md border px-3 py-2 text-sm"
        >
          <p>
            {t('failure.message', {
              day: t(`failure.${which}`),
              forum: failure.forum,
              hall: failure.hallNo,
            })}{' '}
            {failure.officialUrl === null ? (
              t('failure.openOfficial')
            ) : (
              <a
                href={failure.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {t('failure.openOfficial')}
              </a>
            )}
            {', '}
            {t('failure.shareAgain')}
          </p>
          {failure.readAt === null ? null : (
            <p className="text-ink-muted text-xs">
              {t('failure.lastKnown', { time: time.format(failure.readAt) })}
            </p>
          )}
        </div>
      ))}
      {changes === 0 ? null : (
        <div className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          <p role="status" aria-live="polite">
            {t('diff.banner', { count: changes })}
          </p>
          <ListDiffSheet diffs={diffs} />
        </div>
      )}
    </div>
  );
}
