'use client';
// The playbook form (#903): name, court, preferred format, standard prayers and annexure order.
// Submitting only proposes the playbook (`onPropose`); it is saved when the lawyer confirms the
// proposal. `initial` prefills the form when a pending proposal is edited.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import { parseLines } from '../../lib/memory/m5-state.ts';

export interface PlaybookDraft {
  name: string;
  courtId: string | null;
  format: string;
  standardPrayers: string[];
  annexureOrder: string[];
}

export interface PlaybookEditorProps {
  initial?: PlaybookDraft | undefined;
  /** Offline or view-only: the form is disabled. */
  readOnly?: boolean | undefined;
  busy?: boolean | undefined;
  onPropose: (playbook: PlaybookDraft) => void;
}

const FIELD = 'border-line bg-surface min-h-11 rounded-md border px-3 py-2 text-sm';

export function PlaybookEditor({
  initial,
  readOnly = false,
  busy = false,
  onPropose,
}: PlaybookEditorProps) {
  const t = useTranslations('memoryM5.editor');
  const [name, setName] = useState(initial?.name ?? '');
  const [courtId, setCourtId] = useState(initial?.courtId ?? '');
  const [format, setFormat] = useState(initial?.format ?? '');
  const [prayers, setPrayers] = useState((initial?.standardPrayers ?? []).join('\n'));
  const [annexures, setAnnexures] = useState((initial?.annexureOrder ?? []).join('\n'));
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    onPropose({
      name: name.trim(),
      courtId: courtId.trim() === '' ? null : courtId.trim(),
      format: format.trim(),
      standardPrayers: parseLines(prayers),
      annexureOrder: parseLines(annexures),
    });
  };
  return (
    <form
      data-slot="playbook-editor"
      aria-label={t('title')}
      onSubmit={submit}
      className="border-line bg-surface-raised flex flex-col gap-3 rounded-xl border p-4"
    >
      <h2 className="text-lg font-semibold">{t('title')}</h2>
      <fieldset disabled={readOnly || busy} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('name')}
          <input
            className={FIELD}
            required
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('court')}
          <input
            className={FIELD}
            value={courtId}
            onChange={(e) => {
              setCourtId(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('format')}
          <input
            className={FIELD}
            required
            maxLength={80}
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('prayers')}
          <textarea
            className={FIELD}
            rows={4}
            value={prayers}
            onChange={(e) => {
              setPrayers(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('annexures')}
          <textarea
            className={FIELD}
            rows={3}
            value={annexures}
            onChange={(e) => {
              setAnnexures(e.target.value);
            }}
          />
        </label>
      </fieldset>
      <div>
        <Button type="submit" disabled={readOnly || busy}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
