'use client';

// One forum on the courts index (#399): its name, the adapter level, side, languages and the latest
// parse status as a dot paired with text. When this workspace's newest list for the forum was
// degraded or failed, a banner names the unreadable halls with "Open the official list" (a
// new-window link to the court's page, never fetched) and "Share it again" (to the Inbox).
import type { CourtsIndexForum } from '@causedeck/core/court';
import { Alert, AlertTitle } from '@causedeck/ui/alert';
import { Badge } from '@causedeck/ui/badge';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { FocusEventHandler, KeyboardEventHandler, Ref } from 'react';

import { AdapterLevelBadge } from './adapter-level-badge.tsx';

const cn = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ');

/** A forum's language, named in that language: the chip carries the matching `lang`. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ta: 'தமிழ்',
  kn: 'ಕನ್ನಡ',
  hi: 'हिन्दी',
};

/**
 * `ta` or `kn` when the text is written in Tamil or Kannada script, so screen readers and fonts
 * switch for it; undefined otherwise (forum names are mostly English, whatever the court's language).
 */
export function scriptLang(text: string): 'ta' | 'kn' | undefined {
  if (/[஀-௿]/u.test(text)) return 'ta';
  if (/[ಀ-೿]/u.test(text)) return 'kn';
  return undefined;
}

type StatusKey = 'ok' | 'degraded' | 'failed' | 'none';

const DOT_TONE: Record<StatusKey, string> = {
  ok: 'text-success',
  degraded: 'text-warning',
  failed: 'text-danger',
  none: 'text-ink-muted',
};

export function forumHref(slug: string, code: string): string {
  return `/w/${encodeURIComponent(slug)}/courts/${encodeURIComponent(code)}`;
}

/** The card's display name: court, then establishment. */
export function forumName(forum: Pick<CourtsIndexForum, 'court' | 'establishment'>): string {
  return forum.establishment === null ? forum.court : `${forum.court}, ${forum.establishment}`;
}

export interface ForumCardProps {
  forum: CourtsIndexForum;
  slug: string;
  /** Roving tabindex from the grid: 0 for the active card, -1 for the rest. */
  tabIndex?: number;
  linkRef?: Ref<HTMLAnchorElement>;
  onKeyDown?: KeyboardEventHandler<HTMLAnchorElement>;
  onFocus?: FocusEventHandler<HTMLAnchorElement>;
}

export function ForumCard({ forum, slug, tabIndex, linkRef, onKeyDown, onFocus }: ForumCardProps) {
  const t = useTranslations('courts');
  const status: StatusKey = forum.latestParse?.status ?? 'none';
  const languages = [
    forum.languageProfile.primary,
    ...(forum.languageProfile.secondary ?? []),
  ].filter((lang, index, all): lang is string => lang !== undefined && all.indexOf(lang) === index);
  const failing = status === 'degraded' || status === 'failed';
  const halls = forum.latestParse?.hallsUnreadable ?? [];

  return (
    <div
      data-forum-card={forum.code}
      className={cn(
        'border-line bg-surface flex h-full flex-col gap-3 rounded-md border p-4',
        'transition-shadow duration-150 hover:shadow-sm motion-safe:hover:-translate-y-px',
        'dark:border-line dark:hover:shadow-none',
      )}
    >
      <Link
        ref={linkRef}
        href={forumHref(slug, forum.code)}
        data-forum-link={forum.code}
        tabIndex={tabIndex}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className="focus-visible:outline-ring flex flex-col gap-2 rounded-sm outline-offset-2 focus-visible:outline-2"
      >
        <span className="flex flex-col">
          <span lang={scriptLang(forum.court)} className="font-serif text-lg font-medium">
            {forum.court}
          </span>
          {forum.establishment === null ? null : (
            <span lang={scriptLang(forum.establishment)} className="text-ink-muted text-sm">
              {forum.establishment}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <AdapterLevelBadge level={forum.adapterLevel} />
          {forum.side === 'original' || forum.side === 'appellate' ? (
            <Badge tone="outline" data-forum-side={forum.side}>
              {t(`side.${forum.side}`)}
            </Badge>
          ) : null}
          {forum.workspaceOwned ? <Badge tone="info">{t('workspaceOwned')}</Badge> : null}
          {languages.length > 0 ? (
            <span className="inline-flex flex-wrap gap-1" aria-label={t('languagesLabel')}>
              {languages.map((lang) => (
                <Badge key={lang} lang={lang} data-forum-language={lang}>
                  {LANGUAGE_NAMES[lang] ?? lang}
                </Badge>
              ))}
            </span>
          ) : null}
        </span>
        <span data-forum-status={status} className="inline-flex items-center gap-1.5 text-sm">
          <span
            aria-hidden="true"
            data-slot="status-dot"
            className={cn('size-2 rounded-full bg-current', DOT_TONE[status])}
          />
          <span className="text-ink-muted">{t(`status.${status}`)}</span>
        </span>
      </Link>
      {failing ? (
        <Alert tone={status === 'failed' ? 'danger' : 'warning'} data-forum-banner={status}>
          <AlertTitle>
            {halls.length > 0
              ? t(halls.length === 1 ? 'banner.hall' : 'banner.halls', { halls: halls.join(', ') })
              : t('banner.generic')}
          </AlertTitle>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {forum.officialList === null ? null : (
              <a
                href={forum.officialList.url}
                target={forum.officialList.target}
                rel={forum.officialList.rel}
                tabIndex={tabIndex}
                data-forum-official={forum.code}
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
              data-forum-share={forum.code}
              className="text-accent underline-offset-2 hover:underline"
            >
              {t('banner.shareAgain')}
            </Link>
          </span>
        </Alert>
      ) : null}
    </div>
  );
}
