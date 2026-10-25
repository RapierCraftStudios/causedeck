// Bench-notice alerts (#496, D-048): an official notice about a leave, a special bench or a roster
// change that affects a listed matter. Each alert shows what changed, the matter and the days it is
// listed, the notice's kind and source, and a link to the official notice, opened in a new window.
// Renders nothing when there is none. No judge is named: the card carries the notice's own title.
// A URL that is not http(s) is shown as text, never as a link.
import type { BenchNoticeAlert } from '@causedeck/core/court';
import { Badge } from '@causedeck/ui/badge';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

/** An alert as the card shows it. */
export type BenchNoticeAlertView = Pick<
  BenchNoticeAlert,
  | 'noticeId'
  | 'title'
  | 'url'
  | 'kind'
  | 'type'
  | 'sourceName'
  | 'matterId'
  | 'matterTitle'
  | 'listDates'
>;

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export interface BenchNoticeAlertsProps {
  alerts: readonly BenchNoticeAlertView[];
  /** When given, the matter title links to the matter; the matter page leaves it out. */
  slug?: string;
}

export function BenchNoticeAlerts({ alerts, slug }: BenchNoticeAlertsProps) {
  const t = useTranslations('notices');
  if (alerts.length === 0) return null;
  return (
    <section
      aria-labelledby="bench-notice-alerts-title"
      data-slot="bench-notice-alerts"
      className="border-line bg-surface flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="bench-notice-alerts-title" className="font-serif text-lg font-medium">
        {t('benchAlerts.title')}
      </h2>
      <ul className="flex flex-col gap-3">
        {alerts.map((alert) => (
          <li
            key={`${alert.noticeId}:${alert.matterId}`}
            data-bench-alert={`${alert.noticeId}:${alert.matterId}`}
            className="flex flex-col gap-1.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{t(`benchAlerts.type.${alert.type}`)}</Badge>
              <Badge tone="neutral">{t(`kind.${alert.kind}`)}</Badge>
            </div>
            <h3 className="text-sm font-medium">{alert.title}</h3>
            <p className="text-ink-muted text-xs tabular-nums">
              {slug === undefined ? null : (
                <Link
                  href={`/w/${slug}/matters/${alert.matterId}`}
                  className="text-accent underline underline-offset-2"
                >
                  {alert.matterTitle}
                </Link>
              )}
              {slug === undefined ? null : ' · '}
              {t('benchAlerts.listed', {
                count: alert.listDates.length,
                dates: alert.listDates.join(', '),
              })}
            </p>
            <p data-provenance="source" className="text-ink-muted text-xs">
              {t('benchAlerts.source', { source: alert.sourceName })}
            </p>
            {isWebUrl(alert.url) ? (
              <a
                href={alert.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent inline-flex w-fit items-center gap-1 text-sm underline-offset-2 hover:underline"
              >
                {t('benchAlerts.open')}
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            ) : (
              <span className="text-ink-muted text-xs break-all">{alert.url}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
