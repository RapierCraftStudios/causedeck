'use client';
// The calendar import review (#53; PRD CA-5; docs/product/09 §4.2), shown from the capture's result:
// every hearing-like event of the file with what it would do, each confirmed or skipped on its own
// row. There is no bulk confirm for next dates. An unmatched event can only be attached to a matter
// as an undated note or skipped; no matter is created from a calendar event. Confirming goes through
// the engine, so a date changes only on that click (and has the engine's undo). While the file is
// still being read the page refreshes itself; a file that could not be read says so.
import { Button } from '@causedeck/ui/button';
import { Badge } from '@causedeck/ui/badge';
import { toast } from '@causedeck/ui/sonner';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { Result } from '../../../lib/safe-action.ts';
import { SettingSection } from '../setting-section.tsx';
import { useOnline } from '../settings-offline-banner.tsx';

export type ReviewPreview =
  { kind: 'next_date' | 'conflict'; date: string } | { kind: 'listing_update' | 'none' };

export interface ReviewRowView {
  uid: string;
  status: 'proposed' | 'unmatched' | 'unchanged' | 'skipped' | 'noted' | 'applied';
  summary: string;
  location: string | null;
  /** `YYYY-MM-DD`. */
  eventDate: string;
  /** `HH:MM`, or null for an all-day event. */
  eventTime: string | null;
  matterId: string | null;
  preview: ReviewPreview;
}

export interface ReviewActions {
  confirm(input: unknown): Promise<Result<{ uid: string; status: 'applied' }>>;
  skip(input: unknown): Promise<Result<{ uid: string; status: 'skipped' }>>;
  note(input: unknown): Promise<Result<{ uid: string; status: 'noted' }>>;
}

export interface ImportReviewProps {
  workspaceId: string;
  captureId: string;
  /** The capture's status: queued/processing refresh the page, failed says so. */
  captureStatus: string;
  summary: { new?: number; changed?: number; unchanged?: number; ignored?: number } | null;
  rows: ReviewRowView[];
  matters: { id: string; title: string }[];
  actions: ReviewActions;
}

const READING = new Set(['received', 'scanning', 'queued', 'processing']);
const SETTLED = new Set(['applied', 'skipped', 'noted', 'unchanged']);

export function ImportReview({
  workspaceId,
  captureId,
  captureStatus,
  summary,
  rows: initial,
  matters,
  actions,
}: ImportReviewProps) {
  const t = useTranslations('calendar.review');
  const format = useFormatter();
  const router = useRouter();
  const online = useOnline();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [matterId, setMatterId] = useState('');
  const reading = READING.has(captureStatus);

  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => {
      router.refresh();
    }, 3000);
    return () => {
      clearInterval(timer);
    };
  }, [reading, router]);

  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });

  async function act<T extends { uid: string; status: ReviewRowView['status'] }>(
    uid: string,
    call: () => Promise<Result<T>>,
    ok: 'confirmed' | 'skipped' | 'noted',
  ) {
    setBusy(uid);
    let result: Result<T>;
    try {
      result = await call();
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setBusy(null);
    if (!result.ok) {
      toast(t(result.error.code === 'FORBIDDEN' ? 'toast.forbidden' : 'toast.error'));
      return;
    }
    setRows((current) =>
      current.map((row) => (row.uid === uid ? { ...row, status: result.data.status } : row)),
    );
    setAttaching(null);
    toast(t(`toast.${ok}`));
  }

  const row = (item: ReviewRowView) => {
    const settled = SETTLED.has(item.status);
    const unmatched = item.status === 'unmatched' || (item.matterId === null && !settled);
    return (
      <li
        key={item.uid}
        data-slot="calendar-review-row"
        data-status={item.status}
        className="flex flex-col gap-2 py-3"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium">{item.summary}</span>
          <span className="text-ink-muted text-sm tabular-nums">
            {t('when', {
              date: day(item.eventDate),
              time: item.eventTime ?? t('allDay'),
            })}
          </span>
        </div>
        {item.location === null ? null : <p className="text-ink-muted text-sm">{item.location}</p>}
        <p className="text-sm" data-slot="calendar-review-preview">
          {unmatched
            ? t('preview.unmatched')
            : item.preview.kind === 'next_date' || item.preview.kind === 'conflict'
              ? t(`preview.${item.preview.kind}`, { date: day(item.preview.date) })
              : t(`preview.${item.preview.kind}`)}
        </p>
        {settled ? (
          <Badge tone="neutral" data-slot="calendar-review-status">
            {t(`status.${item.status as 'applied' | 'skipped' | 'noted' | 'unchanged'}`)}
          </Badge>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unmatched ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null || !online}
                data-slot="calendar-review-attach"
                onClick={() => {
                  setAttaching(attaching === item.uid ? null : item.uid);
                }}
              >
                {t('attach')}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy !== null || !online}
                aria-busy={busy === item.uid || undefined}
                data-slot="calendar-review-confirm"
                onClick={() => {
                  void act(
                    item.uid,
                    () => actions.confirm({ workspaceId, captureId, uid: item.uid }),
                    'confirmed',
                  );
                }}
              >
                {t('confirm')}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null || !online}
              data-slot="calendar-review-skip"
              onClick={() => {
                void act(
                  item.uid,
                  () => actions.skip({ workspaceId, captureId, uid: item.uid }),
                  'skipped',
                );
              }}
            >
              {t('skip')}
            </Button>
          </div>
        )}
        {attaching === item.uid ? (
          <div
            className="flex flex-col gap-2 md:flex-row md:items-center"
            data-slot="calendar-review-note"
          >
            <label className="sr-only" htmlFor={`attach-${item.uid}`}>
              {t('attachMatter')}
            </label>
            <select
              id={`attach-${item.uid}`}
              className="border-line-control bg-surface-raised min-h-9 min-w-0 rounded-md border px-2 text-sm md:flex-1"
              value={matterId}
              onChange={(event) => {
                setMatterId(event.currentTarget.value);
              }}
            >
              <option value="">{t('attachChoose')}</option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.title}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={matterId === '' || busy !== null || !online}
              onClick={() => {
                void act(
                  item.uid,
                  () => actions.note({ workspaceId, captureId, uid: item.uid, matterId }),
                  'noted',
                );
              }}
            >
              {t('attachConfirm')}
            </Button>
            <p className="text-ink-muted text-xs">{t('attachHint')}</p>
          </div>
        ) : null}
      </li>
    );
  };

  const matched = rows.filter((r) => r.matterId !== null || r.status === 'unchanged');
  const unmatchedRows = rows.filter((r) => !matched.includes(r));
  const counts = summary ?? {};

  return (
    <SettingSection id="calendar-review" title={t('title')} data-slot="calendar-review">
      {reading ? (
        <p className="py-3 text-sm" role="status" data-slot="calendar-review-processing">
          {t('processing')}
        </p>
      ) : captureStatus === 'failed' ? (
        <p className="text-danger py-3 text-sm" role="alert">
          {t('failed')}
        </p>
      ) : (
        <>
          {summary === null ? null : (
            <div className="flex flex-col gap-1 py-3 text-sm" data-slot="calendar-review-summary">
              <p className="font-medium">
                {t('summary', {
                  new: counts.new ?? 0,
                  changed: counts.changed ?? 0,
                  unchanged: counts.unchanged ?? 0,
                })}
              </p>
              {(counts.ignored ?? 0) > 0 ? (
                <p className="text-ink-muted">{t('ignored', { count: counts.ignored ?? 0 })}</p>
              ) : null}
            </div>
          )}
          {rows.length === 0 ? <p className="py-3 text-sm">{t('empty')}</p> : null}
          {matched.length === 0 ? null : (
            <div>
              <h3 className="pt-3 text-sm font-semibold">{t('matchedHeading')}</h3>
              <ul className="divide-line flex flex-col divide-y">{matched.map(row)}</ul>
            </div>
          )}
          {unmatchedRows.length === 0 ? null : (
            <div>
              <h3 className="pt-3 text-sm font-semibold">{t('unmatchedHeading')}</h3>
              <ul className="divide-line flex flex-col divide-y">{unmatchedRows.map(row)}</ul>
            </div>
          )}
        </>
      )}
    </SettingSection>
  );
}
