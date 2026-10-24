'use client';
// "Report an error" on a fetched fact (#518): the next date, stage or bench is wrong. Sending needs
// the user's consent to share the record with CauseDeck staff for correction. Below it, the fixes
// review sent back, each labelled "corrected by CauseDeck review". Reports are open to any member who
// can read the matter; the server action checks again and the case must be one the workspace watches.
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { ReviewCorrectionView } from '../../lib/matters/workspace.ts';
import type { Result } from '../../lib/safe-action.ts';

const FIELDS = ['next_date', 'stage', 'bench'] as const;

export type ReportRecordErrorAction = (input: {
  workspaceId: string;
  proceedingId: string;
  field: (typeof FIELDS)[number];
  shownValue: string;
  reportedValue: string;
  consent: true;
}) => Promise<Result<{ id: string }>>;

export interface ReportErrorProps {
  workspaceId: string;
  proceedingId: string;
  corrections: ReviewCorrectionView[];
  report: ReportRecordErrorAction;
}

export function ReportError({ workspaceId, proceedingId, corrections, report }: ReportErrorProps) {
  const t = useTranslations('matters.workspace.reviewReport');
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<(typeof FIELDS)[number]>('next_date');
  const [shown, setShown] = useState('');
  const [reported, setReported] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent) return;
    setStatus('sending');
    const result = await report({
      workspaceId,
      proceedingId,
      field,
      shownValue: shown,
      reportedValue: reported,
      consent: true,
    });
    if (result.ok) {
      setStatus('sent');
      setOpen(false);
      setShown('');
      setReported('');
      setConsent(false);
    } else {
      setStatus('error');
    }
  }

  return (
    <section aria-label={t('title')} className="mx-auto grid w-full max-w-5xl gap-3 px-4 py-4">
      {corrections.length === 0 ? null : (
        <ul aria-label={t('corrections')} className="grid gap-1 text-sm">
          {corrections.map((c) => (
            <li key={c.id}>
              {t('correction', {
                field: t(`fields.${c.field}`),
                value: c.value,
                date: c.correctedAt,
              })}
            </li>
          ))}
        </ul>
      )}
      {status === 'sent' ? <p role="status">{t('sent')}</p> : null}
      {open ? (
        <form onSubmit={(e) => void onSubmit(e)} className="grid max-w-xl gap-3">
          <div className="grid gap-1">
            <Label htmlFor={`${uid}-field`}>{t('field')}</Label>
            <select
              id={`${uid}-field`}
              value={field}
              onChange={(e) => {
                setField(e.target.value as (typeof FIELDS)[number]);
              }}
              className="border-line rounded border p-2 text-sm"
            >
              {FIELDS.map((f) => (
                <option key={f} value={f}>
                  {t(`fields.${f}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${uid}-shown`}>{t('shown')}</Label>
            <Input
              id={`${uid}-shown`}
              value={shown}
              maxLength={200}
              onChange={(e) => {
                setShown(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${uid}-reported`}>{t('reported')}</Label>
            <Input
              id={`${uid}-reported`}
              value={reported}
              maxLength={200}
              required
              onChange={(e) => {
                setReported(e.target.value);
              }}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
              }}
            />
            <span>{t('consent')}</span>
          </label>
          {status === 'error' ? (
            <p role="alert" className="text-danger text-sm">
              {t('error')}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={!consent || reported.trim() === '' || status === 'sending'}
            >
              {t('send')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setStatus('idle');
              setOpen(true);
            }}
          >
            {t('open')}
          </Button>
        </div>
      )}
    </section>
  );
}
