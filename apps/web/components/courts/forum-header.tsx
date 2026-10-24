'use client';

// A forum's detail header (#400, #42): seat and establishment, the adapter level with its capability
// sentence, side, language chips and this workspace's latest parse as a dot paired with text, then
// the same degraded/failed banner as the forum card. The forum's name is the page title (CourtNav).
import type { Forum, LatestParse, OpenInNewWindow } from '@causedeck/core/court';
import { Badge } from '@causedeck/ui/badge';
import { useTranslations } from 'next-intl';

import { AdapterLevelBadge } from './adapter-level-badge.tsx';
import { DOT_TONE, LANGUAGE_NAMES, scriptLang, type StatusKey } from './forum-card.tsx';
import { ParseBanner } from './parse-banner.tsx';

export type ForumHeaderForum = Pick<
  Forum,
  'code' | 'establishment' | 'seat' | 'side' | 'languageProfile' | 'adapterLevel' | 'workspaceId'
>;

export interface ForumHeaderProps {
  forum: ForumHeaderForum;
  slug: string;
  /** This workspace's newest parse run for the forum (from the courts index), or null. */
  latestParse: LatestParse | null;
  /** The forum's official cause-list page for the banner, or null. */
  officialList: OpenInNewWindow | null;
}

export function ForumHeader({ forum, slug, latestParse, officialList }: ForumHeaderProps) {
  const t = useTranslations('courts');
  const status: StatusKey = latestParse?.status ?? 'none';
  const languages = [
    forum.languageProfile.primary,
    ...(forum.languageProfile.secondary ?? []),
  ].filter((lang, index, all): lang is string => lang !== undefined && all.indexOf(lang) === index);
  const place = [forum.establishment, forum.seat].filter((part): part is string => part !== null);

  return (
    <section data-slot="forum-header" data-forum={forum.code} className="flex flex-col gap-3">
      {place.length === 0 ? null : (
        <p className="text-ink-muted text-sm">
          {place.map((part, index) => (
            <span key={part} lang={scriptLang(part)}>
              {index > 0 ? ', ' : null}
              {part}
            </span>
          ))}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <AdapterLevelBadge level={forum.adapterLevel} withDescription />
        {forum.side === 'original' || forum.side === 'appellate' ? (
          <Badge tone="outline" data-forum-side={forum.side}>
            {t(`side.${forum.side}`)}
          </Badge>
        ) : null}
        {forum.workspaceId === null ? null : <Badge tone="info">{t('workspaceOwned')}</Badge>}
        {languages.length > 0 ? (
          <span className="inline-flex flex-wrap gap-1" aria-label={t('languagesLabel')}>
            {languages.map((lang) => (
              <Badge key={lang} lang={lang} data-forum-language={lang}>
                {LANGUAGE_NAMES[lang] ?? lang}
              </Badge>
            ))}
          </span>
        ) : null}
      </div>
      <p data-forum-status={status} className="inline-flex items-center gap-1.5 text-sm">
        <span
          aria-hidden="true"
          data-slot="status-dot"
          className={`size-2 rounded-full bg-current ${DOT_TONE[status]}`}
        />
        <span className="text-ink-muted">{t(`status.${status}`)}</span>
      </p>
      <ParseBanner
        code={forum.code}
        slug={slug}
        latestParse={latestParse}
        officialList={officialList}
      />
    </section>
  );
}
