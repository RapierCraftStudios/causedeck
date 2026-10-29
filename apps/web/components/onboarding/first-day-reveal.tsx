'use client';
// The first-day reveal (#92): the last step. One line, `Your court day for <date> is ready.`, with
// the counts of briefs ready and obligations in the starter queue, then the board. The reveal eases
// out over 250 ms (instant under reduced motion). With nothing listed (import skipped) the board is
// empty but guided, and the demo workspace is one click away when the member has it: never a dead
// end. Dates go through `formatDate` (IST day, the member's locale).
import { formatDate } from '@causedeck/i18n';
import { isLocale } from '@causedeck/i18n/locales';
import { Button } from '@causedeck/ui/button';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';

import { StepActions } from './step-actions.tsx';
import type { StepScope } from './steps.ts';
import { useStepSubmit } from './use-step-submit.ts';

export interface FirstDay {
  /** `YYYY-MM-DD` of the next listed day, or `null` when nothing is listed. */
  date: string | null;
  briefs: number;
  openObligations: number;
}

export interface FirstDayRevealProps {
  scope: StepScope;
  firstDay: FirstDay;
  /** The board to open: Today, Tomorrow, or Today when the day is further off. */
  boardHref: string;
  briefsHref: string;
  /** The demo workspace's board, only when the member can open it. */
  demoHref?: string | undefined;
}

export function FirstDayReveal({
  scope,
  firstDay,
  boardHref,
  briefsHref,
  demoHref,
}: FirstDayRevealProps) {
  const t = useTranslations('onboarding.done');
  const active = useLocale();
  const locale = isLocale(active) ? active : 'en';
  const { submit, pending, failure } = useStepSubmit(scope, boardHref);

  return (
    <div className="flex flex-col gap-5">
      <div
        data-slot="first-day-reveal"
        className="bg-surface-raised border-line motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 flex flex-col gap-2 rounded-lg border p-5 motion-safe:duration-250 motion-safe:ease-out"
      >
        <p role="status" className="font-serif text-xl font-medium">
          {firstDay.date === null
            ? t('revealNone')
            : t('reveal', {
                date: formatDate(`${firstDay.date}T00:00:00+05:30`, { locale }),
              })}
        </p>
        {firstDay.date === null ? (
          <p className="text-ink-muted text-sm">{t('revealNoneHint')}</p>
        ) : (
          <ul className="text-ink-muted flex flex-col gap-1 text-sm">
            <li>{t('summary.briefs', { count: firstDay.briefs })}</li>
            <li>{t('summary.obligations', { count: firstDay.openObligations })}</li>
          </ul>
        )}
      </div>
      {failure ? (
        <p role="alert" className="text-danger text-sm">
          {t('failed')}
        </p>
      ) : null}
      <StepActions
        type="button"
        label={t('open')}
        pending={pending}
        onPrimary={() => void submit('done')}
      />
      <div className="flex flex-col items-start gap-1">
        {firstDay.date === null ? null : (
          <Button asChild variant="link" size="md">
            <Link href={briefsHref}>{t('openBriefs')}</Link>
          </Button>
        )}
        {demoHref ? (
          <div className="flex flex-col gap-0.5">
            <Button asChild variant="link" size="md">
              <Link href={demoHref}>{t('demo')}</Link>
            </Button>
            <p className="text-ink-muted text-sm">{t('demoHint')}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
