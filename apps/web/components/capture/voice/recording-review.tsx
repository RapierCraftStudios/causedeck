'use client';
// The review step after a recording (#543): play it back, re-record, optionally keep or drop the
// matter it was opened from, add a key line for an on-device date hint, and Save in one action.
import { Alert, AlertDescription } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { dateHint, formatElapsed } from '../../../lib/capture/voice/recorder.ts';

export interface RecordingReviewProps {
  url: string;
  durationMs: number;
  /** The matter the sheet was opened from; shown with a way to drop it. */
  matterId?: string | undefined;
  onClearMatter: () => void;
  busy: boolean;
  onAgain: () => void;
  onSave: () => void;
}

export function RecordingReview({
  url,
  durationMs,
  matterId,
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
      {matterId === undefined ? null : (
        <div className="flex items-center justify-between gap-2 text-sm" data-slot="voice-matter">
          <span className="text-ink">{t('review.matter')}</span>
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
