// The attention strip (#59): adapter-failure banners (UJ-9) and the list-change banner. Failed halls
// keep their last known data on screen, labelled as such, with the official list one click away
// (new window, never framed) and the share-again prompt.
import type { ExpectedNotListed, ListDiff } from '@causedeck/validators';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import type { HallFailure } from './load-court-day.ts';
import { ListDiffSheet } from './list-diff-sheet.tsx';

export async function AttentionStrip({
  slug,
  which,
  failures,
  diffs,
  expected,
  locale,
}: {
  slug: string;
  which: 'today' | 'tomorrow';
  failures: readonly HallFailure[];
  diffs: readonly ListDiff[];
  expected: readonly ExpectedNotListed[];
  locale: string;
}) {
  const t = await getTranslations('courtDay.board');
  const changes = diffs.reduce((n, d) => n + d.added.length + d.removed.length + d.moved.length, 0);
  if (failures.length === 0 && changes === 0 && expected.length === 0) return null;
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <div data-attention-strip className="flex flex-col gap-2">
      {failures.map((failure) => (
        <div
          key={`${failure.forum}-${failure.hallNo}`}
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
            <Link href={`/w/${slug}/inbox`} className="underline">
              {t('failure.shareAgain')}
            </Link>
          </p>
          {failure.readAt === null ? null : (
            <p className="text-ink-muted text-xs">
              {t('failure.lastKnown', { time: time.format(failure.readAt) })}
            </p>
          )}
        </div>
      ))}
      {expected.map((item) => (
        <p
          key={item.proceedingId}
          data-expected-not-listed
          className="border-border rounded-md border px-3 py-2 text-sm"
        >
          {t('expectedNotListed', { case: item.caseLabel, day: t(`failure.${which}`) })}
        </p>
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
