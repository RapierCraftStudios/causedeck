'use client';

// The parse-failure banner of a forum (#399, #400): when this workspace's newest list for the forum
// was degraded or failed, it names the unreadable halls with "Open the official list" (a new-window
// link to the court's page, never fetched) and "Share it again" (to the Inbox). The forum card on
// the index and the forum header on the detail page both render it.
import type { LatestParse, OpenInNewWindow } from '@causedeck/core/court';
import { Alert, AlertTitle } from '@causedeck/ui/alert';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export interface ParseBannerProps {
  code: string;
  slug: string;
  latestParse: LatestParse | null;
  officialList: OpenInNewWindow | null;
  /** Roving tabindex from the index grid; the detail page leaves it unset. */
  tabIndex?: number | undefined;
}

/** Nothing unless the newest list was degraded or failed. */
export function ParseBanner({ code, slug, latestParse, officialList, tabIndex }: ParseBannerProps) {
  const t = useTranslations('courts');
  const status = latestParse?.status;
  if (status !== 'degraded' && status !== 'failed') return null;
  const halls = latestParse?.hallsUnreadable ?? [];
  return (
    <Alert tone={status === 'failed' ? 'danger' : 'warning'} data-forum-banner={status}>
      <AlertTitle>
        {halls.length > 0
          ? t(halls.length === 1 ? 'banner.hall' : 'banner.halls', { halls: halls.join(', ') })
          : t('banner.generic')}
      </AlertTitle>
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        {officialList === null ? null : (
          <a
            href={officialList.url}
            target={officialList.target}
            rel={officialList.rel}
            tabIndex={tabIndex}
            data-forum-official={code}
            className="text-accent inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            {t('banner.openOfficial')}
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t('banner.newWindow')}</span>
          </a>
        )}
        <Link
          href={`/w/${encodeURIComponent(slug)}/inbox`}
          tabIndex={tabIndex}
          data-forum-share={code}
          className="text-accent underline-offset-2 hover:underline"
        >
          {t('banner.shareAgain')}
        </Link>
      </span>
    </Alert>
  );
}
