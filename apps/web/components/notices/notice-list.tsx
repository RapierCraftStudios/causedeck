// Official notices (#588, D-048): one list for the Notices page and the matter's "affecting this
// matter" card. Each notice shows its kind, dates, forums, the source it was recorded from
// (provenance) and a link to the official notice, opened in a new window. Nothing here fetches a
// court page. A URL that is not http(s) is shown as text, never as a link.
import type { NoticeRow } from '@causedeck/core/notices';
import { Badge } from '@causedeck/ui/badge';
import { EmptyState } from '@causedeck/ui/empty-state';
import { ExternalLink, Megaphone } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** A notice as the components show it: dates are plain `YYYY-MM-DD` strings. */
export interface NoticeView {
  id: string;
  title: string;
  kind: NoticeRow['kind'];
  issuedOn: string;
  effectiveOn: string | null;
  url: string;
  forumCodes: string[];
  sourceName: string;
  recordedOn: string;
  matterCount: number;
}

export function toNoticeView(row: NoticeRow): NoticeView {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    issuedOn: row.issuedOn,
    effectiveOn: row.effectiveOn,
    url: row.url,
    forumCodes: row.forumCodes,
    sourceName: row.sourceName,
    recordedOn: row.recordedAt.toISOString().slice(0, 10),
    matterCount: row.matterCount,
  };
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export interface NoticeListProps {
  notices: readonly NoticeView[];
  /** The compact form (matter card): no forum codes and no matter count. */
  compact?: boolean;
}

export function NoticeList({ notices, compact = false }: NoticeListProps) {
  const t = useTranslations('notices');
  return (
    <ul data-slot="notice-list" className="flex flex-col gap-3">
      {notices.map((notice) => (
        <li
          key={notice.id}
          data-notice={notice.id}
          className="border-line bg-surface flex flex-col gap-1.5 rounded-lg border p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{t(`kind.${notice.kind}`)}</Badge>
            <span className="text-ink-muted text-xs tabular-nums">
              {t('issued', { date: notice.issuedOn })}
            </span>
            {notice.effectiveOn === null ? null : (
              <span className="text-ink-muted text-xs tabular-nums">
                {t('effective', { date: notice.effectiveOn })}
              </span>
            )}
          </div>
          <h3 className="text-sm font-medium">{notice.title}</h3>
          {compact ? null : (
            <p className="text-ink-muted text-xs">
              {notice.forumCodes.length > 0
                ? t('forums', { codes: notice.forumCodes.join(', ') })
                : null}
              {notice.forumCodes.length > 0 && notice.matterCount > 0 ? ' · ' : null}
              {notice.matterCount > 0 ? t('matters', { count: notice.matterCount }) : null}
            </p>
          )}
          <p data-provenance="source" className="text-ink-muted text-xs tabular-nums">
            {t('provenance', { source: notice.sourceName, date: notice.recordedOn })}
          </p>
          {isWebUrl(notice.url) ? (
            <a
              href={notice.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent inline-flex w-fit items-center gap-1 text-sm underline-offset-2 hover:underline"
            >
              {t('open')}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          ) : (
            <span className="text-ink-muted text-xs break-all">{notice.url}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Title of the matter's "Affecting this matter" card. */
export function MatterNoticesTitle() {
  const t = useTranslations('notices');
  return <>{t('matterCard.title')}</>;
}

/** Body of the matter's "Affecting this matter" card: the compact list, or an empty state. */
export function MatterNoticesBody({ notices }: { notices: readonly NoticeView[] }) {
  const t = useTranslations('notices');
  if (notices.length === 0) {
    return (
      <EmptyState
        data-pattern-state="empty"
        data-notices="empty"
        icon={<Megaphone />}
        title={t('matterCard.empty')}
        className="py-6"
      />
    );
  }
  return <NoticeList notices={notices} compact />;
}
