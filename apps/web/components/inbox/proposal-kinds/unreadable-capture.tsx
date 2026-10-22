'use client';
// The unreadable-capture card (#48): the exact recovery copy and three ways out, none of which
// guesses content. `Retake` opens the capture sheet (camera or upload); `Type the key line` opens
// an inline textarea that creates a manual (L0) capture linked to the original; `Keep as
// attachment` marks the capture ready as an unprocessed document.
import { Button } from '@causedeck/ui/button';
import { Textarea } from '@causedeck/ui/textarea';
import { FileQuestion } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { InboxItemView } from '../../../lib/inbox/view.ts';

export interface UnreadableCaptureProps {
  item: InboxItemView;
  disabled: boolean;
  disabledReason?: string | undefined;
  readOnly: boolean;
  error?: string | undefined;
  onRetake: () => void;
  onKeep: () => void;
  onKeyLine: (text: string) => void;
}

export function UnreadableCapture({
  item,
  disabled,
  disabledReason,
  readOnly,
  error,
  onRetake,
  onKeep,
  onKeyLine,
}: UnreadableCaptureProps) {
  const t = useTranslations('inbox');
  const titleId = useId();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const line = text.trim();
    if (line !== '') onKeyLine(line);
  };

  return (
    <article
      aria-labelledby={titleId}
      data-proposal-id={item.id}
      data-phase="idle"
      data-slot="unreadable-card"
      tabIndex={0}
      className="bg-surface-raised border-line focus-visible:outline-ring grid gap-3 rounded-xl border p-4 outline-offset-2 focus-visible:outline-2"
    >
      <h3 id={titleId} className="text-ink flex items-center gap-2 font-serif text-lg">
        <FileQuestion aria-hidden="true" className="text-ink-muted size-4 shrink-0" />
        {t('unreadable.title')}
      </h3>
      <p className="text-ink text-sm">{t('unreadable.copy')}</p>
      {error ? (
        <p role="alert" className="text-danger bg-danger-soft rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}
      {readOnly ? (
        <p className="text-ink-muted text-xs">{t('readOnly')}</p>
      ) : typing ? (
        <form onSubmit={submit} className="grid gap-2">
          <label className="grid gap-1 text-sm">
            <span>{t('unreadable.keyLine')}</span>
            <Textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
              rows={3}
              maxLength={2000}
              disabled={disabled}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={disabled || text.trim() === ''} title={disabledReason}>
              {t('unreadable.submit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setTyping(false);
              }}
            >
              {t('card.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onRetake} className="pointer-coarse:min-h-11">
            {t('unreadable.retake')}
          </Button>
          <Button
            variant="secondary"
            disabled={disabled}
            title={disabledReason}
            onClick={() => {
              setTyping(true);
            }}
            className="pointer-coarse:min-h-11"
          >
            {t('unreadable.type')}
          </Button>
          {item.canKeep ? (
            <Button
              variant="ghost"
              disabled={disabled}
              title={disabledReason}
              onClick={onKeep}
              className="pointer-coarse:min-h-11"
            >
              {t('unreadable.keep')}
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );
}
