'use client';
// The hero (#85): the Prepared & Kept rate in large serif numerals with a weekly sparkline, the
// honest one-line reading ("Prepared and kept: 78 percent of 46 appearances. Previous period: 61
// percent."), small samples labelled, and the plain-language definition one tap away (a native
// disclosure: works on hover-less touch and by keyboard). No count-up: the number is exact.
import type { PreparedKept } from '@causedeck/validators/insights';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DataTableAlt } from './data-table-alt.tsx';
import { percent, rateList, SMALL_SAMPLE } from './format.ts';

function Sparkline({ rates, label }: { rates: readonly (number | null)[]; label: string }) {
  const W = 160;
  const H = 40;
  const known = rates.flatMap((r, i) => (r === null ? [] : [[i, r] as const]));
  const last = Math.max(rates.length - 1, 1);
  const pts = known.map(
    ([i, r]) => `${String(2 + (i / last) * (W - 4))},${String(2 + (1 - r) * (H - 4))}`,
  );
  return (
    <svg
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      role="img"
      aria-label={label}
      className="text-ink h-10 w-40"
      data-slot="insights-sparkline"
    >
      <line x1={0} x2={W} y1={H - 2} y2={H - 2} stroke="currentColor" strokeOpacity={0.1} />
      <polyline fill="none" stroke="var(--chart-1)" strokeWidth={2} points={pts.join(' ')} />
      {pts.length > 0 ? (
        <circle
          cx={pts[pts.length - 1]?.split(',')[0]}
          cy={pts[pts.length - 1]?.split(',')[1]}
          r={3}
          fill="var(--chart-1)"
        />
      ) : null}
    </svg>
  );
}

export function PreparedKeptHero({ data }: { data: PreparedKept }) {
  const t = useTranslations('insights');
  const [table, setTable] = useState(false);
  const rates = data.weeks.map((w) => w.rate);
  const trend = t('hero.trendSummary', { values: rateList(rates) });
  return (
    <section
      aria-labelledby="insights-hero"
      data-slot="insights-hero"
      className="border-line bg-surface flex flex-col gap-3 rounded-xl border p-5 lg:p-8"
    >
      <h2 id="insights-hero" className="text-ink-muted text-sm font-medium">
        {t('hero.label')}
      </h2>
      {data.rate === null ? (
        <p className="text-ink text-lg">{t('hero.noRate')}</p>
      ) : (
        <>
          <p
            className="text-ink font-serif text-6xl font-medium tabular-nums"
            data-slot="insights-hero-rate"
          >
            {percent(data.rate)}%
          </p>
          <p className="text-ink max-w-prose text-base">
            {data.previous.rate === null
              ? t('hero.summaryAlone', { percent: percent(data.rate), n: data.denominator })
              : t('hero.summary', {
                  percent: percent(data.rate),
                  n: data.denominator,
                  previous: percent(data.previous.rate),
                })}
          </p>
        </>
      )}
      {data.denominator > 0 && data.denominator < SMALL_SAMPLE ? (
        <p className="text-ink-muted text-sm">{t('hero.small', { n: data.denominator })}</p>
      ) : null}
      {data.pending > 0 ? (
        <p className="text-ink-muted text-sm">{t('hero.pending', { n: data.pending })}</p>
      ) : null}
      {rateList(rates) === '' ? null : (
        <div className="flex flex-col gap-2">
          <Sparkline rates={rates} label={`${t('hero.trend')}. ${trend}`} />
          <p className="text-ink-muted text-xs">{trend}</p>
        </div>
      )}
      <details className="text-sm">
        <summary className="text-ink focus-visible:outline-focus min-h-11 cursor-pointer underline underline-offset-4 focus-visible:outline-2 md:min-h-8">
          {t('hero.definitionTitle')}
        </summary>
        <p className="text-ink-muted mt-2 max-w-prose">{t('hero.definition')}</p>
      </details>
      <div>
        <button
          type="button"
          aria-pressed={table}
          onClick={() => {
            setTable((v) => !v);
          }}
          className="text-ink focus-visible:outline-focus min-h-11 text-sm underline underline-offset-4 focus-visible:outline-2 md:min-h-8"
        >
          {table ? t('table.hide') : t('table.show')}
        </button>
        {table ? (
          <DataTableAlt
            caption={t('hero.trend')}
            columns={[
              t('table.week'),
              t('table.numerator'),
              t('table.denominator'),
              t('table.rate'),
            ]}
            none={t('table.none')}
            rows={data.weeks.map((w) => [
              w.week,
              String(w.numerator),
              String(w.denominator),
              w.rate === null ? '' : `${String(percent(w.rate))}%`,
            ])}
          />
        ) : null}
      </div>
    </section>
  );
}
