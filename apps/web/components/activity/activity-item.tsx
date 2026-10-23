'use client';
// One activity in the feed (#49; docs/product/09 §6): a level icon (with L1/L2/L3 in its accessible
// name), the one-line summary, the source chip, the matter link, confidence, who and when. Model,
// version, region and who confirmed sit behind an expander so the feed stays scannable. The Undo
// button is the only accent-coloured control on the row; it names its target and shows the days
// left. An undone item is struck through with who undid it; past the window it says so; a viewer
// sees "View only". A row about a matter the member may not read shows only that a change happened.
import type { ActivityView } from '@causedeck/core/automation';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Eye, CircleCheck, ChevronDown, Sparkles, Pencil, type LucideIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { forwardRef, useId, useState, type KeyboardEvent } from 'react';

import { UndoCountdown } from './undo-countdown.tsx';

const LEVEL_ICON: Record<string, LucideIcon> = {
  L1: Eye,
  L2: CircleCheck,
  L3: Sparkles,
  L4: Pencil,
};

const SOURCES = ['document', 'voice', 'email', 'list', 'form', 'calendar', 'capture'] as const;
type SourceName = (typeof SOURCES)[number];

function sourceName(input: string | null): SourceName | 'unknown' {
  return (SOURCES as readonly string[]).includes(input ?? '') ? (input as SourceName) : 'unknown';
}

export interface ActivityItemProps {
  item: ActivityView;
  workspaceSlug: string;
  now: Date;
  /** Names of members by user id (who confirmed, who undid). */
  names: ReadonlyMap<string, string>;
  /** The viewer may undo (`matter.write`). */
  canUndo: boolean;
  offline: boolean;
  focused: boolean;
  /** Undone in this session, before the page re-reads. */
  undone: { by: string | null; at: string } | undefined;
  onUndo: (item: ActivityView) => void;
  onOpenCapture: (captureId: string) => void;
  onFocus: () => void;
}

export const ActivityItem = forwardRef<HTMLLIElement, ActivityItemProps>(function ActivityItem(
  {
    item,
    workspaceSlug,
    now,
    names,
    canUndo,
    offline,
    focused,
    undone,
    onUndo,
    onOpenCapture,
    onFocus,
  },
  ref,
) {
  const t = useTranslations('activity.item');
  const format = useFormatter();
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const Icon = LEVEL_ICON[item.level] ?? Eye;
  const undoneAt = undone?.at ?? item.undoneAt;
  const undoneBy = undone === undefined ? item.undoneBy : undone.by;
  const isUndone = undoneAt !== null;
  const timeOf = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    });
  const summary = item.summary ?? t('redacted');
  const undoable = item.undoable && !isUndone && undone === undefined;
  // L3, not undone, not confirmed: the undo window is what decides the rest.
  const windowCandidate = item.level === 'L3' && !isUndone && item.confirmedAt === null;
  const windowEnded = windowCandidate && Date.parse(item.undoExpiresAt) < now.getTime();
  // Core clears `undoable` for a viewer, so "View only" is read from the window, not from `undoable`.
  const viewOnlyNote = !canUndo && windowCandidate && !windowEnded && undone === undefined;
  const confidence = item.confidence === null ? null : Math.round(Number(item.confidence) * 100);
  const source = sourceName(item.inputSource);

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      setOpen((value) => !value);
    }
  };

  return (
    <li
      ref={ref}
      data-slot="activity-item"
      data-activity-id={item.id}
      data-level={item.level}
      data-undone={isUndone ? '' : undefined}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className="border-line bg-surface-raised focus-visible:outline-ring flex flex-col gap-2 rounded-lg border p-3 outline-offset-2 focus-visible:outline-2 md:flex-row md:items-start md:gap-3"
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span
          data-slot="activity-icon"
          className="border-line bg-surface-sunken text-ink-muted flex size-8 shrink-0 items-center justify-center rounded-full border [&_svg]:size-4"
        >
          <Icon aria-hidden="true" />
          <span className="sr-only">{t(`level.${item.level}`)}</span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p
            data-slot="activity-summary"
            className={`text-[15px] leading-[22px] ${isUndone ? 'text-ink-muted line-through' : 'text-ink'}`}
          >
            {summary}
          </p>
          {item.redacted ? <p className="text-ink-muted text-xs">{t('redactedHint')}</p> : null}
          <div className="text-ink-muted flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="neutral">
              <span className="sr-only">{t('sourceLabel', { source: t(`source.${source}`) })}</span>
              <span aria-hidden="true">{t(`source.${source}`)}</span>
            </Badge>
            {item.matterId !== null && item.matterTitle !== null ? (
              <a
                href={`/w/${encodeURIComponent(workspaceSlug)}/matters/${item.matterId}`}
                className="text-accent focus-visible:outline-ring underline-offset-2 outline-offset-2 hover:underline focus-visible:outline-2"
              >
                {t('matter', { title: item.matterTitle })}
              </a>
            ) : null}
            {confidence === null ? null : <span>{t('confidence', { percent: confidence })}</span>}
            <time dateTime={item.createdAt}>{timeOf(item.createdAt)}</time>
          </div>
          {isUndone ? (
            <p data-slot="activity-undone" className="text-ink-muted text-xs">
              {undoneBy !== null && names.has(undoneBy)
                ? t('undone', { name: names.get(undoneBy) ?? '', time: timeOf(undoneAt) })
                : t('undoneUnknown', { time: timeOf(undoneAt) })}
            </p>
          ) : null}
          {item.redacted ? null : (
            <>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => {
                  setOpen((value) => !value);
                }}
                className="text-ink-muted hover:text-ink focus-visible:outline-ring flex w-fit items-center gap-1 rounded-sm text-xs outline-offset-2 focus-visible:outline-2"
              >
                {open ? t('collapse') : t('expand')}
                <ChevronDown
                  aria-hidden="true"
                  className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                />
              </button>
              {open ? (
                <dl
                  id={detailsId}
                  data-slot="activity-details"
                  className="text-ink-muted grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
                >
                  {item.model === null ? (
                    <>
                      <dt>{t('details.model')}</dt>
                      <dd>{t('details.noModel')}</dd>
                    </>
                  ) : (
                    <>
                      <dt>{t('details.model')}</dt>
                      <dd>{item.model}</dd>
                      <dt>{t('details.version')}</dt>
                      <dd>{item.modelVersion ?? '-'}</dd>
                      <dt>{t('details.region')}</dt>
                      <dd>{item.region ?? '-'}</dd>
                    </>
                  )}
                  <dt>{t('details.confirmedBy')}</dt>
                  <dd>
                    {item.confirmedBy === null
                      ? t('details.notConfirmed')
                      : `${names.get(item.confirmedBy) ?? t('details.system')}${item.confirmedAt === null ? '' : `, ${timeOf(item.confirmedAt)}`}`}
                  </dd>
                  {item.captureId === null ? null : (
                    <>
                      <dt>{t('details.capture')}</dt>
                      <dd>
                        <button
                          type="button"
                          className="text-accent underline-offset-2 hover:underline"
                          onClick={() => {
                            onOpenCapture(item.captureId as string);
                          }}
                        >
                          {t('details.capture')}
                        </button>
                      </dd>
                    </>
                  )}
                </dl>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div
        data-slot="activity-undo"
        className="flex flex-col gap-1 max-md:items-stretch md:w-44 md:shrink-0 md:items-end"
      >
        {undoable && canUndo ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={offline}
              aria-label={t('undoLabel', { summary })}
              onClick={() => {
                onUndo(item);
              }}
              className="max-md:w-full"
            >
              {t('undo')}
            </Button>
            {offline ? (
              <span className="text-ink-muted text-xs">{t('offlineUndo')}</span>
            ) : (
              <UndoCountdown undoExpiresAt={item.undoExpiresAt} now={now} />
            )}
          </>
        ) : viewOnlyNote ? (
          <span className="text-ink-subtle text-xs">{t('viewOnly')}</span>
        ) : windowEnded ? (
          <span className="text-ink-muted text-xs">{t('undoEnded')}</span>
        ) : item.level === 'L3' && !isUndone && item.confirmedAt !== null ? (
          <span className="text-ink-muted text-xs">{t('confirmedNoUndo')}</span>
        ) : null}
      </div>
    </li>
  );
});
