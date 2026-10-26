'use client';
// The synopsis (#61, R5): edit in place. The correction is submitted as a matter note through
// `setBriefNoteAction` (confirm-before-save; memory is never written directly, the memory proposal
// path is #72). The strategy line shows only when the payload carries it.
import { Button } from '@causedeck/ui/button';
import { Textarea } from '@causedeck/ui/textarea';
import type { Brief } from '@causedeck/validators';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import { useOfflineEdits } from '../../../../../../../lib/offline/use-outbox.ts';
import { setBriefNoteAction } from '../actions.ts';

import { StatementLine } from './lines.tsx';

export interface SynopsisSectionProps {
  workspaceId: string;
  listingId: string;
  synopsis: NonNullable<Brief['synopsis']>;
  note: string | null;
  canWrite: boolean;
  offline: boolean;
  fallbackLabel: string;
}

export function SynopsisSection({
  workspaceId,
  listingId,
  synopsis,
  note,
  canWrite,
  offline,
  fallbackLabel,
}: SynopsisSectionProps) {
  const t = useTranslations('brief.synopsis');
  const te = useTranslations('brief.prepared');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(note);
  const [text, setText] = useState(note ?? synopsis.line.text);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const id = useId();
  const { slug } = useParams<{ slug: string }>();
  const { enqueue } = useOfflineEdits(slug, workspaceId);

  const save = () => {
    setError(false);
    if (offline) {
      // Sealed on this device; it replays on reconnect (#851).
      void enqueue({ kind: 'brief_note', listingId, note: text }).then((queued) => {
        if (queued) {
          setSaved(text.trim() === '' ? null : text.trim());
          setEditing(false);
        } else {
          setError(true);
        }
      });
      return;
    }
    start(async () => {
      const result = await setBriefNoteAction({ workspaceId, listingId, note: text });
      if (!result.ok) {
        setError(true);
        return;
      }
      setSaved(result.data.note);
      setEditing(false);
    });
  };

  return (
    <div className="grid gap-2">
      <StatementLine
        line={synopsis.line}
        fallbackLabel={fallbackLabel}
        offline={offline}
        viewOnly={!canWrite}
      />
      {synopsis.strategy ? (
        <div>
          <span className="text-muted-foreground font-sans text-xs">{t('strategy')}</span>
          <StatementLine
            line={synopsis.strategy}
            fallbackLabel={fallbackLabel}
            offline={offline}
            viewOnly={!canWrite}
          />
        </div>
      ) : null}
      {saved ? (
        <p data-synopsis-note className="break-inside-avoid">
          <span className="text-muted-foreground font-sans text-xs">{t('note')}: </span>
          {saved}
        </p>
      ) : null}
      {canWrite && !editing ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-edit-synopsis
          className="w-fit print:hidden"
          onClick={() => {
            setEditing(true);
          }}
        >
          {t('edit')}
        </Button>
      ) : null}
      {editing ? (
        <form
          className="grid gap-2 print:hidden"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEditing(false);
          }}
        >
          <label htmlFor={id} className="font-sans text-sm font-medium">
            {t('label')}
          </label>
          <Textarea
            id={id}
            value={text}
            maxLength={5000}
            autoFocus
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <p className="text-muted-foreground font-sans text-xs">{t('hint')}</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {t('save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-destructive font-sans text-sm">
              {te('error')}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
