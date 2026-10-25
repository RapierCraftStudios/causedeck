'use client';
// The Prepared toggle (#61, R3): marks the brief prepared through `markPreparedAction`, shows who
// and when, and shows 'Brief changed since you marked it prepared' once a material change cleared it.
import { Button } from '@causedeck/ui/button';
import type { Brief } from '@causedeck/validators';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';

import { markPreparedAction } from '../actions.ts';

import { showStaleNote } from './model.ts';

export interface PreparedControlProps {
  workspaceId: string;
  listingId: string;
  prepared: Brief['prepared'];
  members: Record<string, string>;
  staleCleared: boolean;
  canWrite: boolean;
  offline: boolean;
}

export function PreparedControl({ workspaceId, listingId, prepared, members, staleCleared, canWrite, offline }: PreparedControlProps) {
  const t = useTranslations('brief.prepared');
  const format = useFormatter();
  const [mark, setMark] = useState<Brief['prepared']>(prepared);
  const [stale, setStale] = useState(showStaleNote(staleCleared, prepared));
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  // The refresh clears the mark once; the note stays across a reload until the brief is marked again.
  const staleKey = `brief-stale:${listingId}`;
  useEffect(() => {
    if (mark !== null) {
      localStorage.removeItem(staleKey);
    } else if (showStaleNote(staleCleared, prepared)) {
      localStorage.setItem(staleKey, '1');
    } else if (localStorage.getItem(staleKey) === '1') {
      setStale(true);
    }
  }, [mark, staleCleared, prepared, staleKey]);

  const toggle = () => {
    const next = mark === null;
    setError(false);
    start(async () => {
      const result = await markPreparedAction({ workspaceId, listingId, prepared: next });
      if (!result.ok) {
        setError(true);
        return;
      }
      setStale(false);
      setMark(result.data.prepared_at === null ? null : { by: result.data.prepared_by, at: result.data.prepared_at });
    });
  };

  const when = mark ? format.relativeTime(new Date(mark.at)) : '';
  const who = mark?.by ? members[mark.by] : undefined;
  return (
    <div data-prepared className="grid gap-1 font-sans text-sm">
      <Button
        type="button"
        size="sm"
        variant={mark ? 'secondary' : 'default'}
        aria-pressed={mark !== null}
        disabled={!canWrite || pending || offline}
        onClick={toggle}
      >
        {mark ? t('unmark') : t('mark')}
      </Button>
      {mark ? <p>{who ? t('by', { name: who, when }) : t('byUnknown', { when })}</p> : null}
      {stale && mark === null ? (
        <p role="status" data-stale-note className="text-muted-foreground">
          {t('stale')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {t('error')}
        </p>
      ) : null}
    </div>
  );
}
