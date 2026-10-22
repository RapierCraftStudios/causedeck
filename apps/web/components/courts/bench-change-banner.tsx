'use client';

// The open bench-change alerts (#435, part 2 of #391): one item per alert on a matter the member may
// read, in calm, precise copy ("Bench changed from 05 Oct: <matter> now sits with Justice X."), the
// matter linked. Each item carries a warning icon plus the text "Bench changed" on the semantic
// warning tokens, never colour alone. The bench is the one the court published for that hall: no
// judge is grouped, counted or ranked (PX-9, ME-6). With no alerts it renders nothing, or with
// `showEmpty` a quiet "No open bench changes." (the 1280 px alerts panel). Items rise in over 200 ms
// ease-out and fade out when they go; reduced motion keeps the fade only.
import type { RostersPageAlert } from '@causedeck/core/court';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';

import { formatDay, presenceClass, usePresence } from './roster-table.tsx';

/** An alert as the banner shows it. */
export type BenchChangeItem = Pick<
  RostersPageAlert,
  'alertId' | 'matterId' | 'matterTitle' | 'effectiveFrom'
> & {
  oldBench: { label: string | null } | null;
  newBench: { label: string | null };
};

/** The matter page an alert links to. */
export function matterHref(slug: string, matterId: string): string {
  return `/w/${encodeURIComponent(slug)}/matters/${encodeURIComponent(matterId)}`;
}

export interface BenchChangeBannerProps {
  slug: string;
  alerts: readonly BenchChangeItem[];
  /** Show the panel with "No open bench changes." when there are none. */
  showEmpty?: boolean;
  className?: string;
}

export function BenchChangeBanner({
  slug,
  alerts,
  showEmpty = false,
  className,
}: BenchChangeBannerProps) {
  const t = useTranslations('courtsRosters.alerts');
  const locale = useLocale();
  const titleId = useId();
  const items = usePresence(alerts, (alert) => alert.alertId);
  if (items.length === 0 && !showEmpty) return null;

  const benchText = (bench: { label: string | null }) => bench.label ?? t('unknownBench');
  return (
    <section
      data-slot="bench-change-banner"
      aria-labelledby={titleId}
      className={['flex flex-col gap-3', className].filter(Boolean).join(' ')}
    >
      <h2 id={titleId} className="font-serif text-lg font-medium">
        {t('title')}
      </h2>
      {items.length === 0 ? (
        <p data-bench-changes-none="" className="text-ink-muted text-sm">
          {t('none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map(({ item: alert, ...presence }) => (
            <li
              key={alert.alertId}
              data-bench-change={alert.alertId}
              aria-hidden={presence.leaving ? true : undefined}
              className={[
                'border-warning/40 bg-warning-soft text-ink flex gap-3 rounded-md border p-3 text-sm',
                presenceClass({ item: alert, ...presence }),
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <TriangleAlert aria-hidden className="text-warning mt-0.5 size-4 shrink-0" />
              <div className="flex flex-col gap-1">
                <span className="text-warning text-xs font-medium">{t('warning')}</span>
                <p>
                  {t.rich('changed', {
                    date: formatDay(alert.effectiveFrom, locale, {
                      day: '2-digit',
                      month: 'short',
                    }),
                    matter: alert.matterTitle,
                    bench: benchText(alert.newBench),
                    link: (chunks) => (
                      <Link
                        href={matterHref(slug, alert.matterId)}
                        data-bench-change-matter=""
                        className="font-medium underline underline-offset-2"
                      >
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
                <p className="text-ink-muted text-xs">
                  {alert.oldBench === null
                    ? t('noPreviousBench')
                    : t('previousBench', { bench: benchText(alert.oldBench) })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
