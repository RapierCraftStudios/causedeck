'use client';
// The drafts list (#826): a row per draft with its matter, template, last edit and the citation and
// consistency summary chips (text plus glyph, never colour alone), a matter filter in the URL and
// the empty states. `New draft` opens the template picker. Only titles and counts are shown here;
// draft text stays in the studio.
import { EmptyState } from '@causedeck/ui/empty-state';
import { CitationStatus } from '@causedeck/ui/patterns';
import { FilePen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';

import type { DraftRowView } from '../../lib/drafting/list.ts';

import { DraftsOfflineBanner } from './drafts-offline-banner.tsx';
import {
  TemplatePicker,
  type CreateDraftFn,
  type MatterOption,
  type TemplateOption,
} from './template-picker.tsx';

const CHIP_CLASS =
  'border-line text-ink inline-flex min-h-6 items-center rounded-full border px-2 text-xs forced-colors:border-current';

export interface DraftsListProps {
  workspaceId: string;
  slug: string;
  rows: DraftRowView[];
  matters: MatterOption[];
  /** The matter the list is filtered to, if any. */
  matterFilter: string | null;
  templates: TemplateOption[];
  createAction: CreateDraftFn;
  /** The member may create drafts (`draft.write`). */
  canCreate?: boolean;
  /** Preview the offline state (stories, `?__state=offline`). */
  forceOffline?: boolean;
  initialPickerOpen?: boolean;
}

export function ConsistencyChips({ consistency }: { consistency: DraftRowView['consistency'] }) {
  const t = useTranslations('drafting.list.chips');
  if (consistency === null) {
    return (
      <span data-drafts-chip="consistency" data-state="pending" className={CHIP_CLASS}>
        {t('consistencyPending')}
      </span>
    );
  }
  const { error, warn, info } = consistency;
  if (error + warn + info === 0) {
    return (
      <span data-drafts-chip="consistency" data-state="clear" className={CHIP_CLASS}>
        {t('consistencyClear')}
      </span>
    );
  }
  return (
    <>
      {error > 0 ? (
        <span data-drafts-chip="consistency" data-state="error" className={CHIP_CLASS}>
          {t('consistencyError', { count: error })}
        </span>
      ) : null}
      {warn > 0 ? (
        <span data-drafts-chip="consistency" data-state="warn" className={CHIP_CLASS}>
          {t('consistencyWarn', { count: warn })}
        </span>
      ) : null}
      {info > 0 ? (
        <span data-drafts-chip="consistency" data-state="info" className={CHIP_CLASS}>
          {t('consistencyInfo', { count: info })}
        </span>
      ) : null}
    </>
  );
}

export function CitationChips({ citations }: { citations: DraftRowView['citations'] }) {
  const t = useTranslations('drafting.list.chips');
  return (
    <>
      <CitationStatus status="verified" label={t('verified', { count: citations.verified })} />
      <CitationStatus status="not_found" label={t('notFound', { count: citations.not_found })} />
      <CitationStatus status="unknown" label={t('unknown', { count: citations.unknown })} />
    </>
  );
}

export function DraftsList({
  workspaceId,
  slug,
  rows,
  matters,
  matterFilter,
  templates,
  createAction,
  canCreate = true,
  forceOffline = false,
  initialPickerOpen = false,
}: DraftsListProps) {
  const t = useTranslations('drafting.list');
  const router = useRouter();
  const format = useFormatter();
  const base = `/w/${encodeURIComponent(slug)}/drafts`;
  const picker = canCreate ? (
    <TemplatePicker
      workspaceId={workspaceId}
      slug={slug}
      templates={templates}
      matters={matters}
      defaultMatterId={matterFilter}
      createAction={createAction}
      initialOpen={initialPickerOpen}
      forceOffline={forceOffline}
    />
  ) : null;

  return (
    <div data-route="drafts" className="flex flex-col gap-6">
      <DraftsOfflineBanner forced={forceOffline} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
          <p className="text-ink-muted text-sm">{t('description')}</p>
        </div>
        {picker}
      </header>
      <label className="flex flex-col gap-1 text-sm md:flex-row md:items-center md:gap-2">
        <span className="text-ink-muted">{t('filterLabel')}</span>
        <select
          data-drafts-filter="matter"
          className="border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm md:w-auto"
          value={matterFilter ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            router.push(value === '' ? base : `${base}?matter=${encodeURIComponent(value)}`);
          }}
        >
          <option value="">{t('filterAll')}</option>
          {matters.map((matter) => (
            <option key={matter.id} value={matter.id}>
              {matter.title}
            </option>
          ))}
        </select>
      </label>
      {rows.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          data-drafts-empty={matterFilter === null ? 'empty' : 'filtered'}
          icon={<FilePen />}
          title={matterFilter === null ? t('empty') : t('emptyFiltered')}
          action={matterFilter === null ? picker : undefined}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              data-drafts-row={row.id}
              className="border-line flex flex-col gap-2 rounded-lg border p-4"
            >
              <Link
                href={row.href}
                aria-label={t('open', { title: row.title })}
                className="text-accent font-medium underline-offset-4 hover:underline"
              >
                {row.title === '' ? t('untitled') : row.title}
              </Link>
              <dl className="text-ink-muted flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div className="flex gap-1">
                  <dt>{t('matter')}:</dt>
                  <dd>{row.matterTitle ?? t('noMatter')}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>{t('template')}:</dt>
                  <dd>{row.templateName}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>{t('lastEdited')}:</dt>
                  <dd>
                    {format.dateTime(new Date(row.updatedAt), {
                      dateStyle: 'medium',
                      timeZone: 'Asia/Kolkata',
                    })}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <CitationChips citations={row.citations} />
                <ConsistencyChips consistency={row.consistency} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
