'use client';
// The review step after a recording (#543): play it back, re-record, optionally keep or drop the
// matter it was opened from, add a key line for an on-device date hint, and Save in one action.
import { Alert, AlertDescription } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import type { searchMattersAction } from '../../../app/(app)/w/[slug]/matters/actions.ts';
import { dateHint, formatElapsed } from '../../../lib/capture/voice/recorder.ts';

export interface RecordingReviewProps {
  url: string;
  durationMs: number;
  workspaceId: string;
  /** The matter search (the sheet passes `searchMattersAction`; a prop keeps server code out of
   *  stories). */
  searchMatters: typeof searchMattersAction;
  /** The linked matter: the one the sheet was opened from or the one picked here. */
  matterId?: string | undefined;
  /** Its title when it was picked here; a prefilled matter has none. */
  matterTitle?: string | undefined;
  onPickMatter: (matter: { id: string; title: string }) => void;
  onClearMatter: () => void;
  busy: boolean;
  onAgain: () => void;
  onSave: () => void;
}

export function RecordingReview({
  url,
  durationMs,
  workspaceId,
  searchMatters,
  matterId,
  matterTitle,
  onPickMatter,
  onClearMatter,
  busy,
  onAgain,
  onSave,
}: RecordingReviewProps) {
  const t = useTranslations('voice');
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState('');
  const hint = dateHint(note);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ id: string; title: string; forum: string | null }[]>([]);
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      searchMatters({ workspaceId, q: term })
        .then((result) => {
          if (live) setFound(result.ok ? result.data : []);
        })
        .catch(() => {
          // Offline or denied: the picker stays empty; the recording saves without a matter.
          if (live) setFound([]);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term, workspaceId, searchMatters]);

  useEffect(() => {
    const element = audio.current;
    return () => {
      element?.pause();
    };
  }, []);

  return (
    <div className="flex flex-col gap-3 p-4" data-slot="voice-review">
      <h2 className="text-ink font-serif text-lg">{t('review.title')}</h2>
      <audio
        ref={audio}
        src={url}
        onEnded={() => {
          setPlaying(false);
        }}
        aria-label={t('review.audio', { time: formatElapsed(durationMs) })}
      />
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          className="min-h-11"
          aria-pressed={playing}
          onClick={() => {
            const element = audio.current;
            if (element === null) return;
            if (playing) {
              element.pause();
              setPlaying(false);
            } else {
              void element.play().then(() => {
                setPlaying(true);
              });
            }
          }}
        >
          {playing ? (
            <Pause aria-hidden="true" className="size-4" />
          ) : (
            <Play aria-hidden="true" className="size-4" />
          )}
          {playing ? t('review.pause') : t('review.play')}
        </Button>
        <span className="text-ink-muted text-sm tabular-nums">{formatElapsed(durationMs)}</span>
      </div>
      {matterId === undefined ? (
        <div className="flex flex-col gap-1 text-sm" data-slot="voice-matter-picker">
          <label className="text-ink flex flex-col gap-1">
            {t('review.matterSearch')}
            <input
              type="search"
              value={query}
              placeholder={t('review.matterSearchPlaceholder')}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              className="border-line bg-surface min-h-11 rounded-md border px-3 text-sm"
            />
          </label>
          {term.length < 2 ? null : found.length === 0 ? (
            <p className="text-ink-muted text-xs" role="status">
              {t('review.matterNone')}
            </p>
          ) : (
            <ul className="flex flex-col" aria-label={t('review.matterSearch')}>
              {found.map((hit) => (
                <li key={hit.id}>
                  <Button
                    variant="ghost"
                    className="min-h-11 w-full justify-start"
                    data-matter-option={hit.id}
                    onClick={() => {
                      onPickMatter({ id: hit.id, title: hit.title });
                      setQuery('');
                    }}
                  >
                    {hit.title}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-sm" data-slot="voice-matter">
          <span className="text-ink">
            {matterTitle === undefined
              ? t('review.matter')
              : t('review.matterPicked', { title: matterTitle })}
          </span>
          <Button variant="ghost" className="min-h-11" onClick={onClearMatter}>
            {t('review.matterClear')}
          </Button>
        </div>
      )}
      <label className="text-ink flex flex-col gap-1 text-sm">
        {t('review.note')}
        <input
          type="text"
          value={note}
          placeholder={t('review.notePlaceholder')}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          className="border-line bg-surface min-h-11 rounded-md border px-3 text-sm"
        />
      </label>
      {hint === null ? null : (
        <Alert data-slot="voice-date-hint">
          <AlertDescription>
            {t('review.dateHint', { date: hint })} <span>{t('review.dateHintNote')}</span>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={() => {
            onSave();
          }}
        >
          {t('review.save')}
        </Button>
        <Button variant="ghost" className="min-h-11" disabled={busy} onClick={onAgain}>
          {t('review.again')}
        </Button>
      </div>
    </div>
  );
}
