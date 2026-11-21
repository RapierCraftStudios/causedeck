// The tenure panel (#73): the correction rate and the brief-accepted-unedited rate by week as bars
// with a data table alternative. Counts and rates for this workspace only; there is no comparison
// with any other workspace. Server-renderable: no state, no script.
import type { TenureMetrics } from '@causedeck/core/memory';
import { isLocale } from '@causedeck/i18n/locales';
import { getLocale, getTranslations } from 'next-intl/server';

import { barHeightPercent, formatRate } from '../../../../../../lib/memory/memory-format.ts';

export async function TenurePanel({ metrics }: { metrics: TenureMetrics }) {
  const t = await getTranslations('memory.tenure');
  const weeks = metrics.weeks;
  const { briefs, unedited, rate } = metrics.briefAcceptedUnedited;
  const rawLocale = await getLocale();
  const locale = isLocale(rawLocale) ? rawLocale : 'en';
  const pct = (value: number | null) => formatRate(value, locale);
  const maxRate = Math.max(0, ...weeks.map((w) => w.correctionRate ?? 0));
  return (
    <section
      aria-labelledby="memory-tenure-title"
      data-slot="memory-tenure"
      className="flex flex-col gap-3"
    >
      <header>
        <h2 id="memory-tenure-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      <p className="text-sm">
        {t('briefRate')}: <strong>{pct(rate)}</strong>{' '}
        <span className="text-ink-muted">
          ({briefs === 0 ? t('noBriefs') : t('briefSummary', { unedited, briefs })})
        </span>
      </p>
      {weeks.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('noData')}</p>
      ) : (
        <>
          <figure>
            <figcaption className="text-sm font-medium">{t('correctionRate')}</figcaption>
            <ol role="img" aria-label={t('chartLabel')} className="mt-2 flex h-28 items-end gap-2">
              {weeks.map((w) => (
                <li
                  key={w.week}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                  aria-hidden="true"
                >
                  <span className="text-ink-muted text-xs tabular-nums">
                    {pct(w.correctionRate)}
                  </span>
                  <span className="bg-surface-sunken flex h-16 w-full max-w-12 items-end rounded-t">
                    <span
                      className="bg-ink-muted block min-h-px w-full rounded-t"
                      style={{ height: `${String(barHeightPercent(w.correctionRate, maxRate))}%` }}
                    />
                  </span>
                  <span className="text-ink-subtle text-xs">{w.week}</span>
                </li>
              ))}
            </ol>
          </figure>
          <table className="w-full text-start text-sm">
            <caption className="sr-only">{t('tableLabel')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-start">
                  {t('colWeek')}
                </th>
                <th scope="col" className="text-start">
                  {t('colSaved')}
                </th>
                <th scope="col" className="text-start">
                  {t('colCorrected')}
                </th>
                <th scope="col" className="text-start">
                  {t('colCorrection')}
                </th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week}>
                  <th scope="row" className="text-start font-normal">
                    {t('week', { week: w.week })}
                  </th>
                  <td>{w.itemsSaved}</td>
                  <td>{w.corrected}</td>
                  <td>{pct(w.correctionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
