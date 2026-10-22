'use client';
// `Export` (#49): CSV or JSON of the activity log for a chosen date range. It follows
// `GET /api/activity/export`, which checks the session and membership and has core decide who may
// export what (owners the workspace, everyone else their own activity) and write `audit.exported`.
// Paused while offline.
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@causedeck/ui/popover';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import {
  istDay,
  istDayAfter,
  istDayStart,
} from '../../app/(app)/w/[slug]/activity/filter-params.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExportMenuProps {
  workspaceId: string;
  /** The feed's own range, when it has one. */
  from: string | undefined;
  to: string | undefined;
  disabled: boolean;
  /** Today, for the default range. Fixed in tests. */
  now: Date;
}

export function ExportMenu({
  workspaceId,
  from: feedFrom,
  to: feedTo,
  disabled,
  now,
}: ExportMenuProps) {
  const t = useTranslations('activity.export');
  const id = useId();
  const [from, setFrom] = useState(feedFrom ?? istDay(new Date(now.getTime() - 30 * DAY_MS)));
  const [to, setTo] = useState(feedTo ?? istDay(now));
  const invalid = !from || !to || from > to;

  const href = (format: 'csv' | 'json') => {
    const params = new URLSearchParams({
      workspaceId,
      from: istDayStart(from),
      to: istDayAfter(to),
      format,
    });
    return `/api/activity/export?${params.toString()}`;
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size="sm" disabled={disabled}>
          <Download aria-hidden="true" />
          {t('button')}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={t('label')}
        className="flex w-80 flex-col gap-3"
        data-slot="activity-export"
      >
        <p className="text-ink-muted text-sm">{t('description')}</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-from`}>{t('from')}</Label>
            <Input
              id={`${id}-from`}
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-to`}>{t('to')}</Label>
            <Input
              id={`${id}-to`}
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            />
          </div>
        </div>
        {invalid ? (
          <p role="alert" className="text-danger text-xs">
            {t('invalidRange')}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button asChild={!invalid} variant="secondary" size="sm" disabled={invalid}>
            {invalid ? (
              <span>{t('csv')}</span>
            ) : (
              <a href={href('csv')} download>
                {t('csv')}
              </a>
            )}
          </Button>
          <Button asChild={!invalid} variant="secondary" size="sm" disabled={invalid}>
            {invalid ? (
              <span>{t('json')}</span>
            ) : (
              <a href={href('json')} download>
                {t('json')}
              </a>
            )}
          </Button>
        </div>
        <p className="text-ink-muted text-xs">{t('own')}</p>
      </PopoverContent>
    </Popover>
  );
}
